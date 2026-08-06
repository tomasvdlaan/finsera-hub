import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { defineManifest } from '@platform/contracts';
import { MockLanguageModelV4 } from 'ai/test';
import { v7 as uuidv7 } from 'uuid';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { conversations } from '../db/core.schema.js';
import { LlmService } from './llm.service.js';
import { OrchestratorService } from './orchestrator.service.js';
import { AiToolRegistry } from './tool-registry.service.js';

const me: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * What the model is actually shown of the conversation so far.
 *
 * `history` is private, and rightly so — what matters is not the method but what reaches the
 * model, so these go through `ask` and capture the prompt the mock receives. That also means
 * the test keeps working if the assembly moves.
 */
describe('conversation history', () => {
  let orchestrator: OrchestratorService;
  /** Every message handed to the model on the last call. */
  let seen: Array<{ role: string; content: unknown }> = [];

  const model = () =>
    new MockLanguageModelV4({
      doStream: async (options) => {
        seen = (options.prompt as Array<{ role: string; content: unknown }>).filter(
          (m) => m.role !== 'system',
        );
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 't' });
              controller.enqueue({ type: 'text-delta', id: 't', delta: 'ok' });
              controller.enqueue({ type: 'text-end', id: 't' });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              });
              controller.close();
            },
          }),
        } as never;
      },
    });

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`TRUNCATE core.conversations CASCADE`);
    await seedUser(me.userId, 'admin');

    const m = new ManifestRegistry();
    m.register(defineManifest({ name: 'fixture', version: '1.0.0' }));
    m.seal();
    const permissions = new PermissionService(testDb, m);
    orchestrator = new OrchestratorService(
      testDb,
      new LlmService(),
      new AiToolRegistry(m, permissions),
      new RegistryService(testDb, m),
      permissions,
    );
  });

  /** A thread with `pairs` exchanges, all sharing a timestamp the way real ones do. */
  const seedThread = async (pairs: number) => {
    const id = uuidv7();
    await testDb.insert(conversations).values({ id, userId: me.userId, title: 'Long' });
    for (let i = 0; i < pairs; i++) {
      // One statement, exactly as `ask` writes them — so both rows get the same `now()`.
      await testDb.execute(
        sql`INSERT INTO core.messages (id, conversation_id, role, content) VALUES
            (${uuidv7()}, ${id}, 'user', ${`question ${i}`}),
            (${uuidv7()}, ${id}, 'assistant', ${`answer ${i}`})`,
      );
    }
    return id;
  };

  const texts = () =>
    seen.map((m) =>
      typeof m.content === 'string'
        ? m.content
        : ((m.content as Array<{ text?: string }>) ?? []).map((p) => p.text ?? '').join(''),
    );

  it('sends the most recent exchanges, not the first ones', async () => {
    // The bug: ORDER BY created_at ASC LIMIT 20 keeps the OLDEST twenty, so past ten
    // exchanges the assistant never saw another word you said.
    const id = await seedThread(30);
    await orchestrator.ask(me, { message: 'and now?', conversationId: id, model: model() });

    const sent = texts();
    expect(sent).toContain('question 29');
    expect(sent).toContain('answer 29');
    expect(sent).not.toContain('question 0');
    expect(sent[sent.length - 1]).toBe('and now?');
  });

  it('keeps them in the order they happened', async () => {
    const id = await seedThread(4);
    await orchestrator.ask(me, { message: 'latest', conversationId: id, model: model() });

    const sent = texts();
    expect(sent.indexOf('question 1')).toBeLessThan(sent.indexOf('answer 1'));
    expect(sent.indexOf('answer 1')).toBeLessThan(sent.indexOf('question 2'));
  });

  it('keeps a question in front of its own answer despite an identical timestamp', async () => {
    // Both rows of a turn are inserted together, so `now()` is the same for each and time
    // alone cannot order them — the id is what breaks the tie.
    const id = await seedThread(1);
    const times = await testDb.execute(
      sql`SELECT count(DISTINCT created_at)::int n FROM core.messages WHERE conversation_id = ${id}`,
    );
    expect((times.rows[0] as { n: number }).n).toBe(1);

    await orchestrator.ask(me, { message: 'next', conversationId: id, model: model() });
    const sent = texts();
    expect(sent.indexOf('question 0')).toBeLessThan(sent.indexOf('answer 0'));
  });

  it('never opens on an answer with no question in front of it', async () => {
    // A fixed cut lands mid-exchange half the time; some providers reject a leading
    // assistant turn outright and the rest are merely confused by it.
    const id = await seedThread(30);
    await orchestrator.ask(me, { message: 'and now?', conversationId: id, model: model() });
    expect(seen[0]?.role).toBe('user');
  });

  it('sends nothing but the question on a brand new conversation', async () => {
    await orchestrator.ask(me, { message: 'first ever', model: model() });
    expect(texts()).toEqual(['first ever']);
  });

  it('shows a reopened conversation in the order it happened', async () => {
    const id = await seedThread(3);
    const { messages: rows } = await orchestrator.getConversation(me, id);
    expect(rows.map((r) => r.content)).toEqual([
      'question 0',
      'answer 0',
      'question 1',
      'answer 1',
      'question 2',
      'answer 2',
    ]);
  });
});

/**
 * A question that failed is still a question that was asked.
 *
 * Both messages were written only after a successful generation, so an answer that broke took
 * the question down with it: you watched an error appear, reopened the thread, and found
 * nothing at all — not the failure, not the words you had typed. That is the worst moment to
 * lose somebody's sentence, because it is the moment they most want it back.
 */
describe('a failed exchange', () => {
  let orchestrator: OrchestratorService;

  /** A model that answers, for proving the thread still works after a failure. */
  const workingModel = () =>
    new MockLanguageModelV4({
      doStream: async () =>
        ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 't' });
              controller.enqueue({ type: 'text-delta', id: 't', delta: 'ok' });
              controller.enqueue({ type: 'text-end', id: 't' });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              });
              controller.close();
            },
          }),
        }) as never,
    });

  /** A model that dies the way the real one did: mid-stream, after the request went out. */
  const brokenModel = () =>
    new MockLanguageModelV4({
      doStream: async () =>
        ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: 'error',
                error: new Error('The messages do not match the ModelMessage[] schema'),
              });
              controller.close();
            },
          }),
        }) as never,
    });

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`TRUNCATE core.conversations CASCADE`);
    await seedUser(me.userId, 'admin');

    const m = new ManifestRegistry();
    m.register(defineManifest({ name: 'fixture', version: '1.0.0' }));
    m.seal();
    const permissions = new PermissionService(testDb, m);
    orchestrator = new OrchestratorService(
      testDb,
      new LlmService(),
      new AiToolRegistry(m, permissions),
      new RegistryService(testDb, m),
      permissions,
    );
  });

  it('keeps the question, and says what went wrong, when generation fails', async () => {
    await expect(
      orchestrator.ask(me, { message: 'What is open on Power BI?', model: brokenModel() }),
    ).rejects.toThrow(/ModelMessage/);

    const [conversation] = await orchestrator.listConversations(me);
    const { messages: rows } = await orchestrator.getConversation(me, conversation!.id);

    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(rows[0]!.content).toBe('What is open on Power BI?');
    expect(rows[1]!.content).toMatch(/did not work/i);
    expect(rows[1]!.content).toMatch(/ModelMessage/);
  });

  it('leaves the thread able to carry on afterwards', async () => {
    // The failure is stored as the assistant's turn, so every question still has a reply in
    // front of the next one — the history assembly never has to learn about half-turns.
    await expect(
      orchestrator.ask(me, { message: 'First try', model: brokenModel() }),
    ).rejects.toThrow();
    const [conversation] = await orchestrator.listConversations(me);

    const second = await orchestrator.ask(me, {
      message: 'Second try',
      conversationId: conversation!.id,
      model: workingModel(),
    });
    expect(second.answer).toBe('ok');

    const { messages: rows } = await orchestrator.getConversation(me, conversation!.id);
    expect(rows.map((r) => r.content)).toEqual([
      'First try',
      expect.stringMatching(/did not work/i),
      'Second try',
      'ok',
    ]);
  });
});
