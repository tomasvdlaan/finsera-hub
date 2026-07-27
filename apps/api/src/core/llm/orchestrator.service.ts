import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import type { ModelMessage } from 'ai';
import { and, asc, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { conversations, messages } from '../db/core.schema.js';
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
  usage: { inputTokens: number; outputTokens: number };
}

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

    return { conversationId, answer, toolCalls: invocations, usage: result.usage };
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
