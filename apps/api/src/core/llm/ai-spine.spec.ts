import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { LlmService } from './llm.service.js';
import { AiToolRegistry } from './tool-registry.service.js';
import { resetDb, testDb } from '../../test/db.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * The AI spine, end to end (spec §7): manifest declarations become an AI SDK tool set,
 * the model calls one, and it executes under the user's identity with its risk class
 * enforced.
 *
 * The model is mocked deliberately. What needs proving is OUR code — that permissions
 * filter the tool set, that risk classes gate execution, that writes are attributed.
 * A live model would test Anthropic's network, not any of that. The same code path runs
 * against a real model when ANTHROPIC_API_KEY is set (see the final test).
 */
function manifests() {
  const m = new ManifestRegistry();
  m.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      permissions: [
        { capability: 'demo.items.read', description: 'read' },
        { capability: 'demo.items.create', description: 'create' },
      ],
      aiTools: [
        {
          name: 'demo_list_items',
          description: 'List demo items.',
          inputSchema: z.object({ limit: z.number().optional() }),
          outputSchema: z.object({}),
          permission: 'demo.items.read',
          riskClass: 'read',
          handler: 'listItems',
        },
        {
          name: 'demo_create_item',
          description: 'Create a demo item.',
          inputSchema: z.object({ title: z.string() }),
          outputSchema: z.object({}),
          permission: 'demo.items.create',
          riskClass: 'write:draft',
          handler: 'createItem',
        },
        {
          name: 'demo_send_invoice',
          description: 'Send an invoice to a client.',
          inputSchema: z.object({ id: z.string() }),
          outputSchema: z.object({}),
          permission: 'demo.items.create',
          riskClass: 'restricted',
          handler: 'sendInvoice',
        },
        {
          name: 'demo_publish',
          description: 'Publish something client-facing.',
          inputSchema: z.object({ id: z.string() }),
          outputSchema: z.object({}),
          permission: 'demo.items.create',
          riskClass: 'write:commit',
          handler: 'publish',
        },
      ],
    }),
  );
  m.seal();
  return m;
}

/** Denies specific capabilities, so tool-set filtering can be tested against the rule. */
class ScopedPermissions extends PermissionService {
  constructor(
    private readonly denied: Set<string>,
    m: ManifestRegistry,
  ) {
    super(testDb, m);
  }
  override async can(actor: Actor, capability: string): Promise<boolean> {
    if (this.denied.has(capability)) return false;
    return super.can(actor, capability);
  }
}

function build(denied = new Set<string>()) {
  const m = manifests();
  return new AiToolRegistry(m, new ScopedPermissions(denied, m));
}

/** Run a block with env overrides, restoring afterwards. `undefined` unsets a var. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** V4 nests token counts and requires every field, so build them in one place. */
function usage(input: number, output: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

/** A model that calls one tool, then answers — the shape of a real tool-use turn. */
function modelCalling(toolName: string, input: unknown) {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      step += 1;
      if (step === 1) {
        return {
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: usage(10, 5),
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName,
              input: JSON.stringify(input),
            },
          ],
          warnings: [],
        };
      }
      return {
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: usage(12, 8),
        content: [{ type: 'text' as const, text: 'Done.' }],
        warnings: [],
      };
    },
  });
}

describe('AI spine', () => {
  beforeEach(resetDb);

  it('builds the tool set from manifest declarations', async () => {
    const registry = build();
    registry.bind('demo_list_items', async () => ({ items: [] }));
    registry.bind('demo_create_item', async () => ({ id: 'x' }));
    registry.bind('demo_publish', async () => ({ ok: true }));

    const { tools } = await registry.buildToolSet(admin);

    expect(Object.keys(tools).sort()).toEqual([
      'demo_create_item',
      'demo_list_items',
      'demo_publish',
    ]);
  });

  it('never offers a restricted tool', async () => {
    const registry = build();
    registry.bind('demo_send_invoice', async () => ({ sent: true }));

    const { tools } = await registry.buildToolSet(admin);

    // Not offered at all — the model cannot call what it cannot see, which is
    // stronger than refusing after the fact.
    expect(tools['demo_send_invoice']).toBeUndefined();
  });

  it('filters the tool set by the USER’s permissions', async () => {
    const registry = build(new Set(['demo.items.create']));
    registry.bind('demo_list_items', async () => ({ items: [] }));
    registry.bind('demo_create_item', async () => ({ id: 'x' }));

    const { tools } = await registry.buildToolSet(admin);

    // "The assistant is the user": no privileged AI service account exists.
    expect(Object.keys(tools)).toEqual(['demo_list_items']);
  });

  it('skips a declared tool that was never bound', async () => {
    const registry = build();
    const { tools } = await registry.buildToolSet(admin);
    expect(Object.keys(tools)).toEqual([]);
  });

  it('executes a write:draft tool under the calling actor', async () => {
    const registry = build();
    const executor = vi.fn(async (actor: Actor, input: unknown) => ({
      id: 'item-1',
      by: actor.userId,
      input,
    }));
    registry.bind('demo_create_item', executor);

    const { tools } = await registry.buildToolSet(admin);
    const llm = new LlmService();
    const result = await llm.generate({
      model: modelCalling('demo_create_item', { title: 'hello from the skeleton' }),
      messages: [{ role: 'user', content: 'Create an item called "hello from the skeleton".' }],
      tools,
    });

    expect(result.toolCalls[0]).toMatchObject({ toolName: 'demo_create_item' });
    expect(executor).toHaveBeenCalledOnce();
    const [calledActor, calledInput] = executor.mock.calls[0]!;
    expect(calledActor.userId).toBe(admin.userId);
    expect(calledInput).toEqual({ title: 'hello from the skeleton' });
  });

  it('withholds a write:commit tool until confirmed', async () => {
    const registry = build();
    const executor = vi.fn(async () => ({ ok: true }));
    registry.bind('demo_publish', executor);

    const { tools, invocations } = await registry.buildToolSet(admin);
    const llm = new LlmService();
    await llm.generate({
      model: modelCalling('demo_publish', { id: 'item-1' }),
      messages: [{ role: 'user', content: 'Publish item-1.' }],
      tools,
    });

    // Enforced by the orchestrator, not by asking the model to behave.
    expect(executor).not.toHaveBeenCalled();
    expect(invocations[0]).toMatchObject({ executed: false, reason: 'awaiting confirmation' });
  });

  it('executes a write:commit tool once confirmed', async () => {
    const registry = build();
    const executor = vi.fn(async () => ({ ok: true }));
    registry.bind('demo_publish', executor);

    const { tools, invocations } = await registry.buildToolSet(admin, {
      confirmed: new Set(['demo_publish']),
    });
    const llm = new LlmService();
    await llm.generate({
      model: modelCalling('demo_publish', { id: 'item-1' }),
      messages: [{ role: 'user', content: 'Publish item-1, I confirm.' }],
      tools,
    });

    expect(executor).toHaveBeenCalledOnce();
    expect(invocations[0]).toMatchObject({ executed: true, riskClass: 'write:commit' });
  });

  it('reports token usage for the cost model', async () => {
    const llm = new LlmService();
    const result = await llm.generate({
      model: modelCalling('demo_list_items', {}),
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  /**
   * These two set MODEL_STRONG explicitly rather than relying on whatever .env holds —
   * an earlier version assumed Anthropic and broke the moment the default was pointed
   * at Gemini, which is exactly the kind of environment coupling a test should not have.
   */
  it('refuses to resolve a model without an API key', () => {
    const llm = new LlmService();
    withEnv({ MODEL_STRONG: 'anthropic:claude-opus-4-8', ANTHROPIC_API_KEY: undefined }, () => {
      expect(() => llm.resolveModel('strong')).toThrow(/ANTHROPIC_API_KEY/);
    });
    withEnv({ MODEL_STRONG: 'google:gemini-2.5-pro', GOOGLE_GENERATIVE_AI_API_KEY: undefined }, () => {
      expect(() => llm.resolveModel('strong')).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
    });
  });

  it('rejects an unsupported provider string', () => {
    const llm = new LlmService();
    withEnv({ MODEL_STRONG: 'openai:gpt-4' }, () => {
      expect(() => llm.resolveModel('strong')).toThrow(/Unsupported LLM provider/);
    });
  });

  /**
   * The live variant. Skipped without a key, so CI stays green and free — but the code
   * path is identical, so this proves the wiring the moment a key exists.
   */
  it.skipIf(!LlmService.hasCredentials())(
    'calls a real model and executes the tool [live]',
    async () => {
      const registry = build();
      const executor = vi.fn(async () => ({ id: 'item-1' }));
      registry.bind('demo_create_item', executor);

      const { tools } = await registry.buildToolSet(admin);
      const llm = new LlmService();
      await llm.generate({
        role: 'fast',
        system: 'Use the provided tools to fulfil the request.',
        messages: [{ role: 'user', content: 'Create a demo item titled "hello from the skeleton".' }],
        tools,
      });

      expect(executor).toHaveBeenCalled();
    },
    30_000,
  );
});
