import { type INestApplication, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { defineManifest, type Actor } from '@platform/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC } from '../core/auth/public.decorator.js';
import { McpService } from '../core/llm/mcp.service.js';
import { AiToolRegistry } from '../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { PermissionService } from '../core/permissions/permission.service.js';
import { resetDb, testDb } from '../test/db.js';
import { McpController } from './mcp.controller.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/** Stands in for the global `AuthGuard`: no bearer token, no entry; any token is the admin. */
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.headers.authorization) throw new UnauthorizedException('Missing bearer token');
    req.actor = admin;
    return true;
  }
}

function demoTool(name: string, riskClass: 'read' | 'write:commit' | 'restricted') {
  return {
    name,
    description: `${name} description`,
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({}),
    permission: 'demo.items.read',
    riskClass,
    handler: name,
  };
}

/**
 * `/mcp` over a real HTTP socket, through Nest's routing, body parsing and guard — the layer
 * `mcp.spec.ts` deliberately skips. What it checks is protocol behaviour a client depends on:
 * status codes, the JSON-RPC envelope, and that the route is not open to the unauthenticated.
 */
describe('POST /mcp', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    await resetDb();
    const manifests = new ManifestRegistry();
    manifests.register(
      defineManifest({
        name: 'demo',
        version: '1.0.0',
        permissions: [{ capability: 'demo.items.read', description: 'read' }],
        aiTools: [
          demoTool('demo_list', 'read'),
          demoTool('demo_publish', 'write:commit'),
          demoTool('demo_send_invoice', 'restricted'),
        ],
      }),
    );
    manifests.seal();
    const registry = new AiToolRegistry(manifests, new PermissionService(testDb, manifests));
    registry.bind('demo_list', async (_actor, input) => ({ listed: input }));
    registry.bind('demo_publish', async () => ({ published: true }));

    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: McpService, useValue: new McpService(registry, manifests) },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = `${await app.getUrl()}/mcp`.replace('[::1]', 'localhost');
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = { 'content-type': 'application/json', authorization: 'Bearer test' };
  const rpc = (body: unknown, headers: Record<string, string> = auth) =>
    fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted field by field
  const json = async (res: Response): Promise<any> => res.json();

  it('is behind the global guard, not public', async () => {
    expect(Reflect.getMetadata(IS_PUBLIC, McpController)).toBeUndefined();
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'application/json' });
    expect(res.status).toBe(401);
  });

  it('initializes, advertising tools and a protocol version', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: expect.any(String),
        capabilities: { tools: {} },
        serverInfo: { name: 'finsera-platform' },
      },
    });
  });

  it('answers a notification with 202 and no body', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('lists the registry\'s tools with JSON Schema, and never a restricted one', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(200);
    const { result } = await json(res);
    const names = result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['demo_list', 'demo_publish']);
    expect(result.tools[0].inputSchema).toMatchObject({ type: 'object' });
  });

  it('calls a tool and returns its result as text content', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'demo_list', arguments: { id: 'abc' } },
    });
    expect(res.status).toBe(200);
    const { result } = await json(res);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({ listed: { id: 'abc' } });
  });

  it('reports a write:commit tool as not run', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'demo_publish', arguments: { id: 'x' } },
    });
    const { result } = await json(res);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('awaiting_confirmation');
  });

  it('answers an unknown or restricted tool with a JSON-RPC error', async () => {
    for (const name of ['demo_nope', 'demo_send_invoice']) {
      const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name } });
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ id: 5, error: { code: -32602 } });
    }
  });

  it('rejects a call with no tool name, an unknown method, and a non-JSON-RPC body', async () => {
    const noName = await json(await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: {} }));
    expect(noName.error.code).toBe(-32602);

    const unknown = await json(await rpc({ jsonrpc: '2.0', id: 7, method: 'resources/list' }));
    expect(unknown.error.code).toBe(-32601);

    const malformed = await json(await rpc({ hello: 'world' }));
    expect(malformed.error.code).toBe(-32600);
  });
});

describe('GET /mcp', () => {
  it('says there is no stream to open: 405, POST only', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: McpService, useValue: {} },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0);
    try {
      const res = await fetch(`${(await app.getUrl()).replace('[::1]', 'localhost')}/mcp`, {
        headers: { authorization: 'Bearer test' },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    } finally {
      await app.close();
    }
  });
});
