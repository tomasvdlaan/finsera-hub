import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { z } from 'zod';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { McpService, McpUnknownToolError } from './mcp.service.js';
import { AiToolRegistry } from './tool-registry.service.js';
import { resetDb, testDb } from '../../test/db.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };

function tool(
  name: string,
  riskClass: 'read' | 'write:draft' | 'write:commit' | 'restricted',
  permission = 'demo.items.read',
) {
  return {
    name,
    description: `${name} description`,
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({}),
    permission,
    riskClass,
    handler: name,
  };
}

function setup(extra: ReturnType<typeof tool>[] = [], denied = new Set<string>()) {
  const manifests = new ManifestRegistry();
  manifests.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      permissions: [
        { capability: 'demo.items.read', description: 'read' },
        { capability: 'demo.items.create', description: 'create' },
      ],
      aiTools: [
        tool('demo_list', 'read'),
        tool('demo_create', 'write:draft', 'demo.items.create'),
        tool('demo_publish', 'write:commit', 'demo.items.create'),
        tool('demo_send_invoice', 'restricted', 'demo.items.create'),
        ...extra,
      ],
    }),
  );
  manifests.seal();

  class Scoped extends PermissionService {
    override async can(actor: Actor, capability: string) {
      if (denied.has(capability)) return false;
      return super.can(actor, capability);
    }
  }
  const registry = new AiToolRegistry(manifests, new Scoped(testDb, manifests));
  for (const t of manifests.aiTools()) {
    if (t.riskClass !== 'restricted') registry.bind(t.name, async (_a, input) => ({ ran: t.name, input }));
  }
  return { manifests, registry, mcp: new McpService(registry, manifests) };
}

describe('MCP / assistant parity', () => {
  beforeEach(resetDb);

  it('offers exactly the tools the assistant is offered', async () => {
    const { registry, mcp } = setup();
    const viaMcp = (await mcp.listTools(admin)).map((t) => t.name).sort();
    const viaAssistant = (await registry.availableFor(admin)).map((t) => t.name).sort();
    expect(viaMcp).toEqual(viaAssistant);
    expect(viaMcp).toEqual(['demo_create', 'demo_list', 'demo_publish']);
  });

  it('follows the caller\'s permissions, not a list of its own', async () => {
    const { registry, mcp } = setup([], new Set(['demo.items.create']));
    const viaMcp = (await mcp.listTools(admin)).map((t) => t.name);
    expect(viaMcp).toEqual(['demo_list']);
    expect(viaMcp).toEqual((await registry.availableFor(admin)).map((t) => t.name));
  });

  it('picks up a newly declared tool with no MCP-side change', async () => {
    const { mcp } = setup([tool('demo_archive', 'write:draft', 'demo.items.create')]);
    expect((await mcp.listTools(admin)).map((t) => t.name)).toContain('demo_archive');
  });

  it('describes tools with JSON Schema and marks only reads read-only', async () => {
    const { mcp } = setup();
    const list = await mcp.listTools(admin);
    const read = list.find((t) => t.name === 'demo_list')!;
    expect(read.inputSchema).toMatchObject({ type: 'object', properties: { id: { type: 'string' } } });
    expect(read.annotations.readOnlyHint).toBe(true);
    expect(list.find((t) => t.name === 'demo_create')!.annotations.readOnlyHint).toBe(false);
  });
});

describe('MCP calls', () => {
  beforeEach(resetDb);

  it('runs a tool under the caller\'s identity', async () => {
    const { mcp } = setup();
    const res = await mcp.callTool(admin, 'demo_list', { id: 'x' });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content[0]!.text)).toEqual({ ran: 'demo_list', input: { id: 'x' } });
  });

  it('rejects arguments that break the declared schema without running the tool', async () => {
    const { mcp } = setup();
    const res = await mcp.callTool(admin, 'demo_list', { id: 42 });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('Invalid arguments');
  });

  it('does not run write:commit tools — nobody here can confirm them', async () => {
    const { mcp } = setup();
    const res = await mcp.callTool(admin, 'demo_publish', { id: 'x' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('awaiting_confirmation');
  });

  it('answers a restricted, a denied and a nonexistent tool identically', async () => {
    const { mcp } = setup([], new Set(['demo.items.create']));
    for (const name of ['demo_send_invoice', 'demo_create', 'demo_nope']) {
      await expect(mcp.callTool(admin, name, { id: 'x' })).rejects.toBeInstanceOf(McpUnknownToolError);
    }
  });
});

describe('MCP exposability guard', () => {
  beforeEach(resetDb);

  it('passes when every tool can be offered', async () => {
    await expect(setup().mcp.assertEveryToolExposable()).resolves.toBeUndefined();
  });

  it('throws, naming the tool, when a name cannot be an MCP tool name', async () => {
    const long = `demo_${'x'.repeat(70)}`;
    const { mcp } = setup([tool(long, 'read')]);
    await expect(mcp.assertEveryToolExposable()).rejects.toThrow(/not a valid MCP tool name/);
  });
});

describe('MCP exposability of the real platform', () => {
  it('can offer every tool every shipped manifest declares', async () => {
    // Every manifest in the app, found by filename so a new module is covered without editing this.
    const src = join(__dirname, '..', '..');
    const files = [
      join(src, 'shell', 'shell.manifest.ts'),
      ...readdirSync(join(src, 'modules')).flatMap((m) => {
        const dir = join(src, 'modules', m);
        return readdirSync(dir)
          .filter((f) => f.endsWith('.manifest.ts'))
          .map((f) => join(dir, f));
      }),
    ];
    const manifests = new ManifestRegistry();
    for (const file of files) {
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      for (const value of Object.values(mod)) {
        if (value && typeof value === 'object' && 'aiTools' in value && 'name' in value) {
          manifests.register(value as Parameters<ManifestRegistry['register']>[0]);
        }
      }
    }
    manifests.seal();
    expect(manifests.aiTools().length).toBeGreaterThan(0);

    const registry = new AiToolRegistry(manifests, new PermissionService(testDb, manifests));
    await expect(new McpService(registry, manifests).assertEveryToolExposable()).resolves.toBeUndefined();
  });
});

/**
 * The other half of parity. Nothing above can stop someone writing a tool straight into the
 * assistant with the AI SDK's `tool()` helper, bypassing the manifest — it would exist for
 * the assistant and not for MCP. So building tool objects is the registry's job alone, and
 * this fails if any other production file takes it on.
 */
describe('tool construction', () => {
  const root = join(__dirname, '..', '..');
  const BUILDERS = /import[^;]*\b(tool|dynamicTool)\b[^;]*from\s+['"]ai['"]/;

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sources(full);
      return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
    });
  }

  it('happens nowhere outside the AI tool registry', () => {
    const offenders = sources(root).filter((f) => BUILDERS.test(readFileSync(f, 'utf8')));
    expect(offenders, 'declare the tool in a module manifest instead').toEqual([]);
  });
});
