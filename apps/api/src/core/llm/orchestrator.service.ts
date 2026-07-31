import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor, EntityRef } from '@platform/contracts';
import type { LanguageModel, ModelMessage } from 'ai';
import { and, asc, desc, eq, exists, ilike, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { conversationFolders, conversations, messages } from '../db/core.schema.js';
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
            // `toolName`, matching what the live answer returns and what every reader
            // expects. It was written as `tool` and read as `toolName`, so a conversation
            // showed which tools it used until the moment you reloaded it, and then showed a
            // row of blank chips instead. Old rows are normalised on read; see readToolCalls.
            toolName: i.toolName,
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

    /*
     * Named after the fact, and only once.
     *
     * After the `done` frame rather than before it, so the reader is not waiting on a second
     * model call to see their answer — the title lands a second later and the list picks it
     * up on its next read. `history.length === 0` means this was the first exchange, which is
     * the only one worth titling from.
     */
    if (history.length === 0) await this.retitle(conversationId, question, answer);
  }

  // ── conversations ──────────────────────────────────────────

  /**
   * Every conversation this user has had, pinned ones first.
   *
   * The limit went from thirty to two hundred when folders arrived: thirty is fine for a flat
   * list you scroll, and wrong the moment the list is grouped — a folder that silently omits
   * its older half is worse than no folder.
   */
  async listConversations(actor: Actor, query?: string) {
    const where = [eq(conversations.userId, actor.userId)];

    /*
     * Searching titles *and* message text.
     *
     * Titles alone would be almost useless: what people remember about an old conversation is
     * something the assistant said in it, not what they happened to call it. `ILIKE` rather
     * than the platform's semantic search because this is a filter on a list you are already
     * looking at — the answer must be instant and exact, not ranked.
     */
    if (query?.trim()) {
      const needle = `%${query.trim()}%`;
      where.push(
        or(
          ilike(conversations.title, needle),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(messages)
              .where(
                and(eq(messages.conversationId, conversations.id), ilike(messages.content, needle)),
              ),
          ),
        )!,
      );
    }

    return this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        folderId: conversations.folderId,
        pinnedAt: conversations.pinnedAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(and(...where))
      /*
       * `NULLS LAST` is the whole point of writing this by hand.
       *
       * Postgres sorts nulls FIRST on a descending column, so a plain `desc(pinnedAt)` puts
       * every unpinned conversation above every pinned one — the exact opposite of pinning,
       * and silent unless something checks.
       */
      .orderBy(sql`${conversations.pinnedAt} DESC NULLS LAST`, desc(conversations.updatedAt))
      .limit(200);
  }

  /** Rename it, and stop auto-titling from undoing that on the next question. */
  async renameConversation(actor: Actor, id: string, title: string) {
    await this.assertOwned(actor, id);
    const next = title?.trim();
    if (!next) throw new NotFoundException('A conversation needs a name');
    await this.db
      .update(conversations)
      .set({ title: next.slice(0, 120), titleIsAuto: false })
      .where(eq(conversations.id, id));
    return { id, title: next.slice(0, 120) };
  }

  /** Pin or unpin. The timestamp doubles as the ordering among pinned threads. */
  async pinConversation(actor: Actor, id: string, pinned: boolean) {
    await this.assertOwned(actor, id);
    await this.db
      .update(conversations)
      .set({ pinnedAt: pinned ? new Date() : null })
      .where(eq(conversations.id, id));
    return { id, pinned };
  }

  /** Move into a folder, or out of one when `folderId` is null. */
  async moveConversation(actor: Actor, id: string, folderId: string | null) {
    await this.assertOwned(actor, id);
    if (folderId) await this.assertFolderOwned(actor, folderId);
    await this.db.update(conversations).set({ folderId }).where(eq(conversations.id, id));
    return { id, folderId };
  }

  // ── folders ────────────────────────────────────────────────

  async listFolders(actor: Actor) {
    return this.db
      .select({ id: conversationFolders.id, name: conversationFolders.name })
      .from(conversationFolders)
      .where(eq(conversationFolders.userId, actor.userId))
      .orderBy(asc(conversationFolders.name));
  }

  async createFolder(actor: Actor, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) throw new NotFoundException('A folder needs a name');
    const id = uuidv7();
    await this.db
      .insert(conversationFolders)
      .values({ id, userId: actor.userId, name: trimmed.slice(0, 80) });
    return { id, name: trimmed.slice(0, 80) };
  }

  async renameFolder(actor: Actor, id: string, name: string) {
    await this.assertFolderOwned(actor, id);
    const trimmed = name?.trim();
    if (!trimmed) throw new NotFoundException('A folder needs a name');
    await this.db
      .update(conversationFolders)
      .set({ name: trimmed.slice(0, 80) })
      .where(eq(conversationFolders.id, id));
    return { id, name: trimmed.slice(0, 80) };
  }

  /**
   * Delete the folder, keep what was in it.
   *
   * `ON DELETE SET NULL` on the foreign key, so its conversations return to the top level
   * rather than going with it. Deleting a folder is a tidying action, and tidying that
   * destroys a fortnight of answers is not a feature anybody would use twice.
   */
  async deleteFolder(actor: Actor, id: string) {
    await this.assertFolderOwned(actor, id);
    await this.db.delete(conversationFolders).where(eq(conversationFolders.id, id));
    return { id, deleted: true };
  }

  private async assertFolderOwned(actor: Actor, id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: conversationFolders.id })
      .from(conversationFolders)
      .where(and(eq(conversationFolders.id, id), eq(conversationFolders.userId, actor.userId)))
      .limit(1);
    if (!row) throw new ForbiddenException('Folder not found');
  }

  async getConversation(actor: Actor, id: string) {
    await this.assertOwned(actor, id);
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    return { id, messages: rows.map((r) => ({ ...r, toolCalls: readToolCalls(r.toolCalls) })) };
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
      // A placeholder until the answer exists and `retitle` can do better. Truncating the
      // question was the permanent answer for months, which is why the list was a column of
      // near-identical half-sentences.
      title: firstMessage.slice(0, 60),
    });
    return id;
  }

  /**
   * Name a conversation from what it turned out to be about.
   *
   * The list was thirty rows of truncated first questions — "How many clients do we have?"
   * three times over, indistinguishable — because the title was chosen before anyone knew
   * what the conversation was. This runs after the first answer, when there is something to
   * summarise, on the fast model because it is one short line.
   *
   * Failure is silent and deliberate. A title is a convenience; losing it must never cost the
   * answer, and this runs after the answer is already committed.
   */
  private async retitle(id: string, question: string, answer: string): Promise<void> {
    try {
      const { text } = await this.llm.generate({
        role: 'fast',
        system:
          'Name this conversation in at most six words. No quotes, no trailing punctuation, ' +
          'no preamble — reply with the title alone. Prefer the specific noun over the ' +
          'general one: "DocHorse invoice dispute", not "A question about billing".',
        messages: [
          { role: 'user', content: `Question: ${question}\n\nAnswer: ${answer.slice(0, 1200)}` },
        ],
      });
      const title = text.trim().replace(/^["']|["'.]+$/g, '').slice(0, 80);
      if (!title) return;
      // `titleIsAuto` guards the race with a rename: if the reader named it while the model
      // was thinking, the model does not get to name it back.
      await this.db
        .update(conversations)
        .set({ title })
        .where(and(eq(conversations.id, id), eq(conversations.titleIsAuto, true)));
    } catch {
      /* the conversation keeps its truncated question, which is what it had before */
    }
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

/**
 * Stored tool calls, whatever shape they were written in.
 *
 * The column held `{ tool }` for the assistant's whole life while every reader looked for
 * `toolName`, so reopening a conversation lost the record of what it had looked at — the one
 * thing that lets an answer be checked rather than trusted. New rows are written correctly;
 * this is what makes the ones already in the database readable, without a migration that
 * rewrites jsonb in place.
 */
function readToolCalls(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const call = c as Record<string, unknown>;
    return call.toolName ? call : { ...call, toolName: call.tool };
  });
}
