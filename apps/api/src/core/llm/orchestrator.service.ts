import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor, EntityRef } from '@platform/contracts';
import type { LanguageModel, ModelMessage } from 'ai';
import { and, asc, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { conversations, messages } from '../db/core.schema.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { LlmService, type GenerateResult, type TokenUsage } from './llm.service.js';
import { AiToolRegistry, type ToolInvocation } from './tool-registry.service.js';

export interface AskInput {
  message: string;
  conversationId?: string;
  /** The entity the user is looking at, so "this client" resolves without being named. */
  context?: { entityId?: string };
  /** Names of write:commit tools the user has approved for this turn. */
  confirmed?: string[];
  /** Injected in tests, mirroring LlmService — production resolves from configuration. */
  model?: LanguageModel;
}

/** What a streamed ask emits. `done` carries exactly what the blocking call returns. */
export type AskEvent =
  | { type: 'text'; delta: string; conversationId: string }
  | { type: 'tool'; toolName: string; conversationId: string }
  | { type: 'done'; result: AskResult };

export interface AskResult {
  conversationId: string;
  answer: string;
  toolCalls: ToolInvocation[];
  /**
   * Records the answer explicitly cites, resolved through the registry.
   *
   * Only cited records appear — a card is a deliberate act, not a by-product of having
   * touched a row. Every id is still checked against what the tools actually returned,
   * so the model can choose WHICH records to show but cannot invent one.
   */
  references: EntityRef[];
  usage: TokenUsage;
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CITATION_PATTERN = /\[\[entity:([0-9a-f-]{36})\]\]/gi;

/**
 * Cards are for the record being discussed, not for every record consulted. Past a
 * handful the chat stops reading as an answer and starts reading as a search result
 * page, which is the failure this cap exists to prevent.
 */
const MAX_REFERENCES = 3;

const HISTORY_LIMIT = 20;

/**
 * The assistant's harness (AI plan §3.2).
 *
 * Everything it can do comes from module manifests, and every tool runs under the asking
 * user's identity — "the assistant is the user". The orchestrator enforces the risk
 * classes itself rather than instructing the model to behave, because a model reading an
 * untrusted document cannot be trusted to police itself.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
    private readonly tools: AiToolRegistry,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Ask, and wait for the whole answer.
   *
   * A thin drain of `askStream`. There is exactly one flow — permissions, tool set, model
   * call, citation resolution, persistence — and two shapes on top of it, because the moment
   * there were two copies the streaming one would have grown a fix the blocking one never
   * got.
   */
  async ask(actor: Actor, input: AskInput): Promise<AskResult> {
    for await (const event of this.askStream(actor, input)) {
      if (event.type === 'done') return event.result;
    }
    throw new Error('The assistant produced no answer.');
  }

  /**
   * Ask, and watch it happen.
   *
   * Emits `tool` as each call is made and `text` as words arrive, then one `done` carrying
   * everything the blocking call returns. The order matters: tool events dominate the early
   * part of a real answer, which is exactly the stretch that used to be a silent spinner.
   */
  async *askStream(actor: Actor, input: AskInput): AsyncGenerator<AskEvent> {
    const question = input.message?.trim();
    if (!question) throw new NotFoundException('Message is empty');

    const conversationId = input.conversationId
      ? await this.assertOwned(actor, input.conversationId)
      : await this.startConversation(actor, question);

    const history = await this.history(conversationId);
    const { tools, invocations } = await this.tools.buildToolSet(actor, {
      confirmed: new Set(input.confirmed ?? []),
    });

    const system = await this.systemPrompt(actor, input.context?.entityId);

    let result: GenerateResult | undefined;
    for await (const event of this.llm.stream({
      role: 'strong',
      system,
      messages: [...history, { role: 'user', content: question }],
      tools,
      maxSteps: 8,
      model: input.model,
    })) {
      if (event.type === 'done') result = event.result;
      // The conversation id goes out with the first event a caller sees, so a client that
      // is interrupted mid-answer still knows which thread to reopen.
      else yield { ...event, conversationId };
    }
    if (!result) throw new Error('The model stream ended without a result.');

    const answer =
      result.text.trim() ||
      'I could not produce an answer for that. Try rephrasing, or ask something narrower.';

    const references = await this.collectReferences(actor, invocations, answer);

    await this.db.transaction(async (tx) => {
      await tx.insert(messages).values([
        { id: uuidv7(), conversationId, role: 'user', content: question, toolCalls: [] },
        {
          id: uuidv7(),
          conversationId,
          role: 'assistant',
          content: answer,
          toolCalls: invocations.map((i) => ({
            tool: i.toolName,
            module: i.module,
            riskClass: i.riskClass,
            executed: i.executed,
            reason: i.reason ?? null,
          })),
          references,
        },
      ]);
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    });

    this.logger.log(
      `ask: ${result.steps} step(s), ${invocations.length} tool call(s), ` +
        `${result.usage.inputTokens}+${result.usage.outputTokens} tokens` +
        // The share of input that cost a tenth of list price. A multi-step answer with a
        // cold cache and one with a warm cache differ by more than they look on the bill.
        (result.usage.cacheReadTokens > 0
          ? `, ${Math.round((result.usage.cacheReadTokens / Math.max(1, result.usage.inputTokens)) * 100)}% cached`
          : ''),
    );

    yield {
      type: 'done',
      result: { conversationId, answer, toolCalls: invocations, references, usage: result.usage },
    };
  }

  // ── conversations ──────────────────────────────────────────

  async listConversations(actor: Actor) {
    return this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, actor.userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(30);
  }

  async getConversation(actor: Actor, id: string) {
    await this.assertOwned(actor, id);
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    return { id, messages: rows };
  }

  async deleteConversation(actor: Actor, id: string) {
    await this.assertOwned(actor, id);
    await this.db.delete(conversations).where(eq(conversations.id, id));
  }

  /**
   * The records this answer deliberately cites.
   *
   * Three gates, in order: the model must cite it; the id must have come back from a
   * tool this turn; and the actor must be allowed to see it. The first keeps cards rare
   * and relevant, the second stops the model inventing one, the third stops a card
   * leaking a record the asker cannot open.
   */
  private async collectReferences(
    actor: Actor,
    invocations: ToolInvocation[],
    answer: string,
  ): Promise<EntityRef[]> {
    const cited: string[] = [];
    for (const match of answer.matchAll(CITATION_PATTERN)) {
      const id = match[1]!.toLowerCase();
      if (!cited.includes(id)) cited.push(id);
    }
    if (cited.length === 0) return [];

    // Ids the tools genuinely produced this turn — the model may pick from these, and
    // nothing else.
    const grounded = new Set<string>();
    const harvest = (value: unknown, depth = 0) => {
      if (depth > 6 || grounded.size > 200) return;
      if (typeof value === 'string') {
        for (const m of value.match(UUID_PATTERN) ?? []) grounded.add(m.toLowerCase());
      } else if (Array.isArray(value)) {
        value.forEach((v) => harvest(v, depth + 1));
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach((v) => harvest(v, depth + 1));
      }
    };
    for (const invocation of invocations) {
      harvest(invocation.result);
      harvest(invocation.input);
    }

    const candidates = cited.filter((id) => grounded.has(id));
    if (candidates.length === 0) return [];

    const resolved = await this.registry.resolve(candidates);
    const visible = await this.permissions.visibleIds(
      actor,
      resolved.map((r) => r.id),
    );

    // Keep the model's own ordering: the first thing it cited is what it is talking about.
    const byId = new Map(resolved.map((r) => [r.id.toLowerCase(), r]));
    return candidates
      .map((id) => byId.get(id))
      .filter((r): r is EntityRef => Boolean(r) && visible.has(r!.id) && !r!.deleted)
      .slice(0, MAX_REFERENCES);
  }

  // ── internals ──────────────────────────────────────────────

  /**
   * Conversations are per-user, full stop. A shared conversation would leak whatever the
   * other person's permissions allowed their tools to read.
   */
  private async assertOwned(actor: Actor, conversationId: string): Promise<string> {
    const [row] = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, actor.userId)))
      .limit(1);
    if (!row) throw new ForbiddenException('Conversation not found');
    return row.id;
  }

  private async startConversation(actor: Actor, firstMessage: string): Promise<string> {
    const id = uuidv7();
    await this.db.insert(conversations).values({
      id,
      userId: actor.userId,
      title: firstMessage.slice(0, 60),
    });
    return id;
  }

  private async history(conversationId: string): Promise<ModelMessage[]> {
    const rows = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .limit(HISTORY_LIMIT);

    return rows.map((r) => ({
      role: r.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: r.content,
    }));
  }

  /**
   * The system prompt. Deliberately short: capability comes from the tool set, not from
   * describing the platform in prose the model has to be trusted to follow.
   */
  private async systemPrompt(actor: Actor, contextEntityId?: string): Promise<string> {
    const parts = [
      'You are the assistant inside Finsera\'s internal business platform.',
      'Answer from the tools available to you — never invent clients, projects, hours or amounts.',
      'If a tool returns nothing, say so plainly rather than guessing.',
      'Money is stored in whole euro cents; durations in whole minutes. Convert for the reader.',
      "Be brief. This is a colleague's working tool, not a chat product.",
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      'You may show a record as a card by citing it inline as [[entity:<its id>]], using ' +
        'a real id from a tool result. Do this SPARINGLY — at most one or two per answer, ' +
        'and only for the record the reader is most likely to open or act on next. ' +
        'When listing several records, name them in plain text and cite none of them: a ' +
        'wall of cards is harder to read than a sentence. Never cite a record you are ' +
        'merely mentioning in passing.',
    ];

    if (contextEntityId) {
      // Page context: "this client" should resolve without the user naming it.
      const ref = await this.registry.resolveOne(contextEntityId);
      if (ref) {
        parts.push(
          `The user is currently viewing ${ref.entityType} "${ref.displayName}" (id ${ref.id}). ` +
            'Assume vague references like "this client" or "this project" mean that record.',
        );
      }
    }

    if (actor.role !== 'admin') {
      parts.push('Some records may be invisible to this user; never speculate about them.');
    }

    return parts.join(' ');
  }
}
