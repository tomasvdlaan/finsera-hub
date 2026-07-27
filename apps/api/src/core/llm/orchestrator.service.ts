import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor, EntityRef } from '@platform/contracts';
import type { ModelMessage } from 'ai';
import { and, asc, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { conversations, messages } from '../db/core.schema.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { LlmService } from './llm.service.js';
import { AiToolRegistry, type ToolInvocation } from './tool-registry.service.js';

export interface AskInput {
  message: string;
  conversationId?: string;
  /** The entity the user is looking at, so "this client" resolves without being named. */
  context?: { entityId?: string };
  /** Names of write:commit tools the user has approved for this turn. */
  confirmed?: string[];
}

export interface AskResult {
  conversationId: string;
  answer: string;
  toolCalls: ToolInvocation[];
  /**
   * Records this answer touched, resolved through the registry.
   *
   * The chat renders these as cards, so an answer about a document can show the
   * document rather than describe it. Collected from what the tools actually returned,
   * not from what the model claims — the model cannot invent a reference this way.
   */
  references: EntityRef[];
  usage: { inputTokens: number; outputTokens: number };
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

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

  async ask(actor: Actor, input: AskInput): Promise<AskResult> {
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

    const result = await this.llm.generate({
      role: 'strong',
      system,
      messages: [...history, { role: 'user', content: question }],
      tools,
      maxSteps: 8,
    });

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
        `${result.usage.inputTokens}+${result.usage.outputTokens} tokens`,
    );

    return { conversationId, answer, toolCalls: invocations, references, usage: result.usage };
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
   * Which records this answer is about.
   *
   * Ids are taken from what the tools returned and from the answer text, then resolved
   * through the registry and filtered by what the actor may see. Two consequences worth
   * stating: the model cannot fabricate a reference, because an id it invents will not
   * resolve; and a reference cannot leak, because permission is checked per entity.
   */
  private async collectReferences(
    actor: Actor,
    invocations: ToolInvocation[],
    answer: string,
  ): Promise<EntityRef[]> {
    const ids = new Set<string>();
    const harvest = (value: unknown, depth = 0) => {
      if (depth > 6 || ids.size > 40) return;
      if (typeof value === 'string') {
        for (const match of value.match(UUID_PATTERN) ?? []) ids.add(match.toLowerCase());
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
    harvest(answer);
    if (ids.size === 0) return [];

    const resolved = await this.registry.resolve([...ids]);
    const visible = await this.permissions.visibleIds(
      actor,
      resolved.map((r) => r.id),
    );
    return resolved.filter((r) => visible.has(r.id) && !r.deleted).slice(0, 12);
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
      'When you mention a specific record, cite it inline as [[entity:<its id>]] — the ' +
        'interface turns that into a card the reader can open. Use the real id from a ' +
        'tool result; never invent one.',
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
