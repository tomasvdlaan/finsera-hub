import { Injectable, Logger } from '@nestjs/common';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import {
  generateObject,
  generateText,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';

export type ModelRole = 'strong' | 'fast';

export interface GenerateOptions {
  role?: ModelRole;
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  maxSteps?: number;
  /** Injected in tests — production resolves the model from configuration. */
  model?: LanguageModel;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the prompt cache rather than re-read. */
  cacheReadTokens: number;
  /** Input tokens written into the cache — charged at a premium, once. */
  cacheWriteTokens: number;
}

export interface GenerateResult {
  text: string;
  toolCalls: Array<{ toolName: string; input: unknown }>;
  usage: TokenUsage;
  steps: number;
}

/**
 * What a generation emits as it happens.
 *
 * `tool` matters as much as `text` here, and arguably more: a tool-calling answer spends most
 * of its wall clock deciding and calling before a single word exists, so a stream that only
 * carried text would show a spinner for eight seconds and then a burst. One measured answer
 * today took four steps and ten tool calls; the words were the last two seconds of it.
 */
export type GenerationEvent =
  | { type: 'text'; delta: string }
  /** The model's own working-out, while it is still working it out. */
  | { type: 'thinking'; delta: string }
  | { type: 'tool'; toolName: string }
  | { type: 'done'; result: GenerateResult };

/**
 * Cache the static head of every request: the system prompt and the tool schemas.
 *
 * A tool-calling answer re-sends its entire context on every step. One real answer from the
 * logs took four steps and ten tool calls for 22,994 input tokens against 2,064 output — and
 * the overwhelming majority of that input is the same forty tool schemas, four times over.
 * That prefix is byte-identical on every step of every conversation by every user, which is
 * exactly the shape a prompt cache is for.
 *
 * An hour rather than the five-minute default. The window that matters is a working session:
 * five minutes expires between one question and the next time somebody looks up from what
 * they were doing, which is precisely when the cache would have paid.
 *
 * Anthropic-only, applied by the provider to the whole static prefix. Other providers ignore
 * an option they do not know, so this stays a single object rather than a branch.
 */
const CACHE_THE_PREFIX = {
  anthropic: { cacheControl: { type: 'ephemeral' as const, ttl: '1h' as const } },
  /*
   * Ask Gemini to say what it is thinking.
   *
   * Off by default, and the silence it leaves is most of the wait: measured on a real
   * two-tool answer, nothing at all reached the client for the first 3.1 seconds, then a tool
   * chip, then another 5.7 seconds of nothing, then the entire answer in 57 milliseconds. A
   * reader watching a caret blink for nine seconds has no way to tell thinking from hung.
   *
   * With this on, the first thought summary arrives at 2.6 seconds and reads like a heading —
   * "Defining the project scope" — which is exactly the amount of detail worth showing.
   *
   * Inert on Anthropic, which takes its own key; both are declared so switching provider does
   * not silently change what the reader sees.
   */
  google: { thinkingConfig: { includeThoughts: true } },
};

/** The four numbers, defaulted — a provider that reports nothing must not become NaN. */
const readUsage = (u?: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
}): TokenUsage => ({
  inputTokens: u?.inputTokens ?? 0,
  outputTokens: u?.outputTokens ?? 0,
  cacheReadTokens: u?.inputTokenDetails?.cacheReadTokens ?? 0,
  cacheWriteTokens: u?.inputTokenDetails?.cacheWriteTokens ?? 0,
});

/**
 * The provider interface (AI plan §3.2, decision D6).
 *
 * THE ONLY DOOR to an LLM. No module imports an AI vendor SDK directly, so switching or
 * routing models is a change here plus an env var — and no gateway sits in the data path
 * with client-confidential prompts.
 *
 * Token usage is logged from day one, feeding the cost model (open decision O6).
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  /** Resolve a 'provider:model' string. Only anthropic today; the switch is the seam. */
  resolveModel(role: ModelRole = 'strong'): LanguageModel {
    const spec =
      role === 'fast'
        ? (process.env.MODEL_FAST ?? 'anthropic:claude-haiku-4-5-20251001')
        : (process.env.MODEL_STRONG ?? 'anthropic:claude-opus-4-8');

    const [provider, ...rest] = spec.split(':');
    const modelId = rest.join(':');

    // Adding a provider is a case here plus an env var — no module code changes,
    // and no gateway sits between us and the vendor holding client-confidential text.
    switch (provider) {
      case 'anthropic': {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — cannot resolve an LLM.');
        return createAnthropic({ apiKey })(modelId);
      }
      case 'google': {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
          throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set — cannot resolve an LLM.');
        }
        return createGoogleGenerativeAI({ apiKey })(modelId);
      }
      default:
        throw new Error(`Unsupported LLM provider '${provider}' in '${spec}'.`);
    }
  }

  /**
   * True when any provider has credentials — used to gate live tests.
   *
   * Deliberately not `??`: an unused key is typically present-but-empty in .env, and
   * `''` is not nullish, so `??` would let a blank ANTHROPIC_API_KEY mask a real
   * Google one.
   */
  static hasCredentials(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  }

  /**
   * A structured answer, validated against a schema.
   *
   * Wrapped here rather than called directly for two reasons: the provider seam is meant
   * to be the only place the AI SDK is touched (D6), and the SDK's generics recurse deep
   * enough on nested schemas that TypeScript gives up — so the typing is pinned once,
   * here, instead of at every call site.
   */
  async generateStructured<T>(opts: {
    schema: z.ZodType<T>;
    system?: string;
    messages: GenerateOptions['messages'];
    role?: ModelRole;
  }): Promise<{ object: T; usage: { inputTokens: number; outputTokens: number } }> {
    const model = this.resolveModel(opts.role ?? 'fast');

    // The SDK's generics recurse deep enough on nested schemas that TypeScript gives up.
    // Inference is severed here, in the one wrapper, rather than at every call site —
    // the schema still validates at runtime, which is what actually protects the caller.
    const call = generateObject as unknown as (args: {
      model: LanguageModel;
      schema: unknown;
      system?: string;
      messages: GenerateOptions['messages'];
      maxRetries: number;
    }) => Promise<{ object: unknown; usage?: { inputTokens?: number; outputTokens?: number } }>;

    const result = await call({
      model,
      schema: opts.schema,
      system: opts.system,
      messages: opts.messages,
      maxRetries: 2,
    });

    // Validated rather than trusted: the SDK asked for this shape, this asserts it got it.
    return {
      object: opts.schema.parse(result.object),
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
    };
  }

  /**
   * Transcribe or otherwise read a file (audio, image) with a prompt.
   *
   * Separate from generate() because it takes no tools and returns plain text: the model
   * is being used as a converter, not an agent.
   */
  async generateFromFile(opts: {
    prompt: string;
    data: Buffer;
    mediaType: string;
    role?: ModelRole;
  }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    const result = await generateText({
      model: this.resolveModel(opts.role ?? 'fast'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt },
            { type: 'file', data: opts.data, mediaType: opts.mediaType },
          ],
        },
      ],
      maxRetries: 2,
    });
    return {
      text: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
    };
  }

  /**
   * The same call, delivered as it arrives.
   *
   * A generator rather than a callback so the caller decides what to do with back-pressure —
   * the orchestrator has to persist the answer and resolve its citations after the last
   * token, and that is far easier to express as code after a `for await` than as a handler.
   *
   * The aggregate is yielded as a final `done` rather than returned, because a generator
   * cannot do both and the caller needs the totals in the same sequence as the deltas.
   */
  async *stream(opts: GenerateOptions): AsyncGenerator<GenerationEvent> {
    const model = opts.model ?? this.resolveModel(opts.role);

    const result = streamText({
      model,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      providerOptions: CACHE_THE_PREFIX,
      stopWhen: stepCountIs(opts.maxSteps ?? 8),
      maxRetries: 2,
    });

    const toolCalls: Array<{ toolName: string; input: unknown }> = [];

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        yield { type: 'text', delta: part.text };
      } else if (part.type === 'reasoning-delta') {
        // Forwarded, never accumulated into the answer: this is the working-out, and it is
        // shown while it happens rather than kept.
        yield { type: 'thinking', delta: part.text };
      } else if (part.type === 'tool-call') {
        toolCalls.push({ toolName: part.toolName, input: part.input });
        yield { type: 'tool', toolName: part.toolName };
      } else if (part.type === 'error') {
        // Surfaced rather than swallowed: the stream ends either way, and a caller that
        // cannot tell "finished" from "broke" writes an empty answer to the database.
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }

    const usage = readUsage(await result.usage);
    this.logger.log(
      `LLM stream: ${usage.inputTokens} in / ${usage.outputTokens} out` +
        (usage.cacheReadTokens ? ` (${usage.cacheReadTokens} cached)` : ''),
    );

    yield {
      type: 'done',
      result: {
        text: await result.text,
        toolCalls,
        usage,
        steps: (await result.steps)?.length ?? 1,
      },
    };
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const model = opts.model ?? this.resolveModel(opts.role);

    // Multi-step: the model may call a tool, read the result, then call another before
    // answering ("which clients are active?" → "how many hours on their projects?").
    // The step cap is a runaway guard, not a feature — a loop that never ends bills.
    const result = await generateText({
      model,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      providerOptions: CACHE_THE_PREFIX,
      stopWhen: stepCountIs(opts.maxSteps ?? 8),
      maxRetries: 2,
    });

    const usage = readUsage(result.usage);
    // Cache reads logged beside the totals, because "is caching working" is otherwise a
    // question you can only answer from an invoice a month later.
    this.logger.log(
      `LLM call: ${usage.inputTokens} in / ${usage.outputTokens} out` +
        (usage.cacheReadTokens || usage.cacheWriteTokens
          ? ` (cache: ${usage.cacheReadTokens} read, ${usage.cacheWriteTokens} written)`
          : ''),
    );

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
      usage,
      steps: result.steps?.length ?? 1,
    };
  }
}
