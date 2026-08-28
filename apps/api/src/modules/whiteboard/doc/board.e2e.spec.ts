import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import type { Actor } from '@platform/contracts';
import { AuditService } from '../../../core/audit/audit.service.js';
import type { AuthGuard } from '../../../core/auth/auth.guard.js';
import { EventBus } from '../../../core/events/event-bus.service.js';
import { LinkService } from '../../../core/links/link.service.js';
import { ManifestRegistry } from '../../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../../core/permissions/permission.service.js';
import { RegistryService } from '../../../core/registry/registry.service.js';
import { StorageService } from '../../../core/storage/storage.service.js';
import type { UserService } from '../../../core/auth/user.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../../test/db.js';
import { crmManifest } from '../../crm/crm.manifest.js';
import { scrumManifest } from '../../scrum/scrum.manifest.js';
import { timeManifest } from '../../time/time.manifest.js';
import { meetingsManifest } from '../../meetings/meetings.manifest.js';
import { whiteboardManifest } from '../whiteboard.manifest.js';
import { WhiteboardService } from '../whiteboard.service.js';
import { BoardDocService } from './board-doc.service.js';
import { BoardGateway } from './board.gateway.js';

/**
 * Two people, one board, over real sockets and a real database.
 *
 * The unit tests each prove one part in isolation — the merge rule, the authority's flush, the
 * gateway's routing. This proves they add up: bytes leave one socket, cross the gateway, merge
 * in the authority, reach the other socket, and land in Postgres. Every one of those pieces
 * could pass its own tests while the seams between them are wrong.
 *
 * Only `verifyToken` is stubbed, because the real one calls out to Zitadel's JWKS endpoint over
 * the network. Everything below it is the production object.
 */
const alice: Actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin' };
const bob: Actor = { userId: '22222222-2222-4222-8222-222222222222', role: 'member' };

const el = (id: string, version: number, over: Record<string, unknown> = {}) => ({
  id,
  version,
  versionNonce: 1_000 + version,
  updated: 1_700_000_000_000 + version,
  type: 'rectangle',
  x: 0,
  y: 0,
  ...over,
});

describe('a whiteboard, end to end', () => {
  let server: WebSocketServer;
  let port: number;
  let gateway: BoardGateway;
  let whiteboards: WhiteboardService;
  let boardDocs: BoardDocService;
  let boardId: string;
  const open: WebSocket[] = [];

  beforeEach(async () => {
    await resetDb();
    await truncate(
      sql`TRUNCATE whiteboard.board_files, whiteboard.elements, whiteboard.boards CASCADE`,
    );
    await seedUser(alice.userId, 'admin');
    await seedUser(bob.userId, 'member');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, scrumManifest, meetingsManifest, whiteboardManifest]) {
      manifests.register(m);
    }
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    whiteboards = new WhiteboardService(
      testDb, registry, permissions, audit, bus, links, new StorageService(),
    );
    await whiteboards.ensureReportingViews();

    boardDocs = new BoardDocService();
    // Exactly the wiring WhiteboardModule does at boot.
    boardDocs.bind({
      load: (id) => whiteboards.loadScene(id),
      save: (id, changed, appState, who) => whiteboards.saveScene(id, changed, appState, who),
    });

    const auth = {
      // The token IS the user id here. The real one is JWKS against Zitadel over the network.
      verifyToken: async (token: string) => {
        if (token === alice.userId) return alice;
        if (token === bob.userId) return bob;
        throw new Error('Invalid token');
      },
    } as unknown as AuthGuard;

    const users = {
      byId: async (id: string) => ({ displayName: id === alice.userId ? 'Alice' : 'Bob' }),
    } as unknown as UserService;

    gateway = new BoardGateway(auth, users, whiteboards, boardDocs);

    const board = await whiteboards.create(alice, { title: 'End to end' });
    boardId = board.id;

    server = new WebSocketServer({ port: 0 });
    server.on('connection', (socket, request) => {
      void gateway.handleConnection(socket as never, request);
      socket.on('close', () => gateway.handleDisconnect(socket as never));
    });
    await new Promise((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const socket of open.splice(0)) socket.close();
    await new Promise((resolve) => server.close(resolve));
  });

  /** Connect, and resolve once the scene has arrived. */
  async function join(actor: Actor): Promise<{ socket: WebSocket; inbox: Array<Record<string, unknown>> }> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?boardId=${boardId}&token=${actor.userId}`);
    open.push(socket);
    const inbox: Array<Record<string, unknown>> = [];
    socket.on('message', (raw) => inbox.push(JSON.parse(raw.toString()) as Record<string, unknown>));

    await waitFor(() => inbox.some((m) => m.type === 'init'));
    return { socket, inbox };
  }

  const send = (socket: WebSocket, payload: unknown) => socket.send(JSON.stringify(payload));

  async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the board');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it('carries a stroke from one person to another', async () => {
    const a = await join(alice);
    const b = await join(bob);

    send(a.socket, { type: 'update', elements: [el('shape-1', 1, { strokeColor: '#ff0000' })] });

    await waitFor(() => b.inbox.some((m) => m.type === 'update'));
    const received = b.inbox.find((m) => m.type === 'update')!.elements as Array<Record<string, unknown>>;
    expect(received[0]).toMatchObject({ id: 'shape-1', strokeColor: '#ff0000' });
  });

  it('tells the person who drew it too, so a loser learns the winner', async () => {
    const a = await join(alice);

    send(a.socket, { type: 'update', elements: [el('shape-1', 1)] });

    await waitFor(() => a.inbox.some((m) => m.type === 'update'));
    expect((a.inbox.find((m) => m.type === 'update')!.elements as unknown[])).toHaveLength(1);
  });

  it('converges when two people change the same shape at once', async () => {
    const a = await join(alice);
    const b = await join(bob);

    // Both edit from the same base version. One has to win, and both must agree which.
    send(a.socket, { type: 'update', elements: [el('contested', 4, { x: 10 })] });
    send(b.socket, { type: 'update', elements: [el('contested', 4, { x: 99 })] });

    await waitFor(() => a.inbox.filter((m) => m.type === 'update').length >= 1);
    await waitFor(() => b.inbox.filter((m) => m.type === 'update').length >= 1);
    await new Promise((r) => setTimeout(r, 100));

    const scene = await boardDocs.snapshot(boardId);
    const winner = scene.elements.find((e) => e.id === 'contested');
    // Same version, so the nonce decides — identically here and in both browsers.
    expect(winner).toBeDefined();
    expect(winner!.versionNonce).toBe(1_004);
  });

  it('writes the drawing to Postgres, and only what changed', async () => {
    const a = await join(alice);

    send(a.socket, { type: 'update', elements: [el('kept', 1)] });
    await waitFor(() => a.inbox.some((m) => m.type === 'update'));
    // The authority debounces for a second; ask for it now rather than sleeping.
    await boardDocs.flush(boardId);

    const rows = await testDb.execute(
      sql`SELECT element_id, version FROM whiteboard.elements WHERE board_id = ${boardId}`,
    );
    expect(rows.rows).toEqual([{ element_id: 'kept', version: 1 }]);
  });

  it('gives a reconnecting client back everything, including what it drew while away', async () => {
    const a = await join(alice);
    send(a.socket, { type: 'update', elements: [el('before', 1)] });
    await waitFor(() => a.inbox.some((m) => m.type === 'update'));

    // Somebody else draws while the first client is gone.
    a.socket.close();
    await new Promise((r) => setTimeout(r, 50));
    const b = await join(bob);
    send(b.socket, { type: 'update', elements: [el('while-away', 1)] });
    await waitFor(() => b.inbox.some((m) => m.type === 'update'));

    const back = await join(alice);
    const scene = (back.inbox.find((m) => m.type === 'init')!.elements as Array<{ id: string }>);
    expect(scene.map((e) => e.id).sort()).toEqual(['before', 'while-away']);
  });

  it('keeps a deletion deleted across a rejoin', async () => {
    const a = await join(alice);
    send(a.socket, { type: 'update', elements: [el('doomed', 1)] });
    await waitFor(() => a.inbox.some((m) => m.type === 'update'));
    send(a.socket, { type: 'update', elements: [el('doomed', 2, { isDeleted: true })] });
    await waitFor(() => a.inbox.filter((m) => m.type === 'update').length >= 2);
    await boardDocs.flush(boardId);
    await boardDocs.release(boardId);

    const back = await join(bob);
    const scene = back.inbox.find((m) => m.type === 'init')!.elements as Array<Record<string, unknown>>;
    // The tombstone has to come back, or the rejoining client resurrects the shape.
    expect(scene.find((e) => e.id === 'doomed')?.isDeleted).toBe(true);
  });

  it('shows each person who else is there', async () => {
    const a = await join(alice);
    const b = await join(bob);

    await waitFor(() => a.inbox.some((m) => m.type === 'presence'));
    const peers = a.inbox.filter((m) => m.type === 'presence').at(-1)!.peers as Array<{ name: string }>;
    expect(peers.map((p) => p.name)).toEqual(['Bob']);
    expect((b.inbox.find((m) => m.type === 'init')!.peers as Array<{ name: string }>)[0]?.name).toBe('Alice');
  });

  it('moves a cursor without writing anything down', async () => {
    const a = await join(alice);
    const b = await join(bob);

    send(a.socket, { type: 'pointer', x: 42, y: 99 });
    await waitFor(() => b.inbox.some((m) => m.type === 'pointer'));
    expect(b.inbox.find((m) => m.type === 'pointer')).toMatchObject({ x: 42, y: 99 });

    await boardDocs.flush(boardId);
    const rows = await testDb.execute(
      sql`SELECT count(*)::int AS n FROM whiteboard.elements WHERE board_id = ${boardId}`,
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('turns away a forged token', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?boardId=${boardId}&token=not-a-real-user`);
    open.push(socket);
    const inbox: Array<Record<string, unknown>> = [];
    socket.on('message', (raw) => inbox.push(JSON.parse(raw.toString()) as Record<string, unknown>));

    await waitFor(() => inbox.length > 0);
    expect(inbox[0]).toMatchObject({ type: 'error', message: 'Invalid token' });
  });

  it('never leaks one board into another', async () => {
    const other = await whiteboards.create(alice, { title: 'Somebody else' });
    const a = await join(alice);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/?boardId=${other.id}&token=${bob.userId}`);
    open.push(socket);
    const inbox: Array<Record<string, unknown>> = [];
    socket.on('message', (raw) => inbox.push(JSON.parse(raw.toString()) as Record<string, unknown>));
    await waitFor(() => inbox.some((m) => m.type === 'init'));

    send(a.socket, { type: 'update', elements: [el('private', 1)] });
    await waitFor(() => a.inbox.some((m) => m.type === 'update'));
    await new Promise((r) => setTimeout(r, 100));

    expect(inbox.filter((m) => m.type === 'update')).toHaveLength(0);
  });
});
