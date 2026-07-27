import { Injectable, Logger } from '@nestjs/common';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';

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

export interface GenerateResult {
  text: string;
  toolCalls: Array<{ toolName: string; input: unknown }>;
  usage: { inputTokens: number; outputTokens: number };
}

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

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const model = opts.model ?? this.resolveModel(opts.role);

    const result = await generateText({
      model,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      stopWhen: opts.maxSteps ? undefined : undefined,
      maxRetries: 2,
    });

    const usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    };
    this.logger.log(`LLM call: ${usage.inputTokens} in / ${usage.outputTokens} out`);

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
      usage,
    };
  }
}
