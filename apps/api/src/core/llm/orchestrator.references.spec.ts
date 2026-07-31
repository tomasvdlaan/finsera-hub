import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { LlmService } from './llm.service.js';
import { OrchestratorService } from './orchestrator.service.js';
import { AiToolRegistry } from './tool-registry.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * Which records become cards.
 *
 * Mocked model on purpose: these are rules the orchestrator enforces, not behaviour the
 * model is asked to be good at, so they must hold for any answer text a model produces.
 */
function manifests() {
  const m = new ManifestRegistry();
  m.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      entities: [{ type: 'thing', displayTemplate: '{name}', urlPattern: '/things/:id', readPermission: 'demo.read' }],
      permissions: [{ capability: 'demo.read', description: 'read' }],
      aiTools: [
        {
          name: 'demo_find',
          description: 'Find things.',
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          permission: 'demo.read',
          riskClass: 'read',
          handler: 'find',
        },
      ],
    }),
  );
  m.seal();
  return m;
}

/**
 * A model that returns a fixed answer after one tool call.
 *
 * `doStream` as well as `doGenerate`, because `ask` is a drain of `askStream` and so every
 * path through the orchestrator now goes through `streamText`. The two implementations
 * describe the same turn — a tool call, then the answer — and the answer is emitted in three
 * deltas rather than one string precisely so that a test can tell a stream that reassembles
 * from one that happens to work because nothing was ever split.
 */
function modelSaying(answer: string) {
  let step = 0;
  const usage = (i: number, o: number) => ({
    inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: o, text: o, reasoning: undefined },
  });

  const thirds = [
    answer.slice(0, Math.ceil(answer.length / 3)),
    answer.slice(Math.ceil(answer.length / 3), Math.ceil((answer.length * 2) / 3)),
    answer.slice(Math.ceil((answer.length * 2) / 3)),
  ];

  return new MockLanguageModelV4({
    doGenerate: async () => {
      step += 1;
      if (step === 1) {
        return {
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: usage(10, 5),
          content: [
            { type: 'tool-call' as const, toolCallId: 'c1', toolName: 'demo_find', input: '{}' },
          ],
          warnings: [],
        };
      }
      return {
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: usage(12, 8),
        content: [{ type: 'text' as const, text: answer }],
        warnings: [],
      };
    },

    doStream: async () => {
      step += 1;
      const parts: unknown[] =
        step === 1
          ? [
              {
                type: 'tool-call',
                toolCallId: 'c1',
                toolName: 'demo_find',
                input: '{}',
              },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usage(10, 5) },
            ]
          : [
              { type: 'text-start', id: 't1' },
              ...thirds.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usage(12, 8) },
            ];

      return {
        stream: new ReadableStream({
          start(controller) {
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
      } as never;
    },
  });
}

describe('assistant references', () => {
  let orchestrator: OrchestratorService;
  let registry: RegistryService;
  let ids: string[];

  const build = (toolResult: unknown) => {
    const m = manifests();
    registry = new RegistryService(testDb, m);
    const permissions = new PermissionService(testDb, m);
    const tools = new AiToolRegistry(m, permissions);
    tools.bind('demo_find', async () => toolResult);
    orchestrator = new OrchestratorService(testDb, new LlmService(), tools, registry, permissions);
  };

  const seedThings = async (count: number) => {
    const created: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = registry.newId();
      await testDb.transaction((tx) =>
        registry.register(tx, {
          id,
          entityType: 'thing',
          displayName: `Thing ${i}`,
          urlPath: `/things/${id}`,
        }),
      );
      created.push(id);
    }
    return created;
  };

  beforeEach(async () => {
    await resetDb();
    await seedUser(actor.userId, 'admin');
    build([]);
    ids = await seedThings(6);
  });

  it('shows no cards when the answer cites nothing', async () => {
    build({ things: ids });
    // The model saw six ids and mentioned none — that must produce a plain answer.
    const model = modelSaying('There are six things.');
    const res = await orchestrator.ask(actor, { message: 'anything', model });
    expect(res.references).toEqual([]);
  });

  it('shows a card for the one record the answer cites', async () => {
    build({ things: ids });
    const model = modelSaying(`Here it is: [[entity:${ids[0]}]]`);
    const res = await orchestrator.ask(actor, { message: 'x', model });
    expect(res.references.map((r) => r.id)).toEqual([ids[0]]);
  });

  it('caps a citation spree at three cards', async () => {
    build({ things: ids });
    const model = modelSaying(ids.map((id) => `[[entity:${id}]]`).join(' '));
    const res = await orchestrator.ask(actor, { message: 'x', model });
    // Past a handful the chat reads as a search results page rather than an answer.
    expect(res.references).toHaveLength(3);
  });

  it('keeps the order the answer cited them in', async () => {
    build({ things: ids });
    const model = modelSaying(`[[entity:${ids[2]}]] then [[entity:${ids[0]}]]`);
    const res = await orchestrator.ask(actor, { message: 'x', model });
    expect(res.references.map((r) => r.id)).toEqual([ids[2], ids[0]]);
  });

  it('drops a citation the tools never returned', async () => {
    // The model may choose WHICH record to show, never invent one.
    build({ things: [ids[0]] });
    const model = modelSaying(`[[entity:${ids[0]}]] and [[entity:${ids[5]}]]`);
    const res = await orchestrator.ask(actor, { message: 'x', model });
    expect(res.references.map((r) => r.id)).toEqual([ids[0]]);
  });

  it('drops a citation for an id that does not exist at all', async () => {
    const ghost = crypto.randomUUID();
    build({ things: [ghost] }); // grounded in a tool result, but not a real entity
    const model = modelSaying(`[[entity:${ghost}]]`);
    const res = await orchestrator.ask(actor, { message: 'x', model });
    expect(res.references).toEqual([]);
  });

  it('deduplicates a record cited twice', async () => {
    build({ things: ids });
    const model = modelSaying(`[[entity:${ids[1]}]] ... again [[entity:${ids[1]}]]`);
    const res = await orchestrator.ask(actor, { message: 'x', model });
    expect(res.references).toHaveLength(1);
  });
});
