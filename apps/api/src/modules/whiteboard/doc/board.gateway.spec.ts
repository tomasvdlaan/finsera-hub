import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardElement } from '@platform/board-doc';
import type { Actor } from '@platform/contracts';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { AuthGuard } from '../../../core/auth/auth.guard.js';
import type { UserService } from '../../../core/auth/user.service.js';
import type { WhiteboardService } from '../whiteboard.service.js';
import { BoardDocService } from './board-doc.service.js';
import { BoardGateway } from './board.gateway.js';

const actor: Actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin' };

const el = (id: string, version = 1): BoardElement => ({
  id,
  version,
  versionNonce: 100 + version,
  updated: 1_700_000_000_000,
  type: 'rectangle',
});

/** Everything the gateway touches on a socket, and nothing else. */
function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  let onMessage: ((raw: string) => void) | undefined;
  const socket = {
    readyState: 1,
    send: (payload: string) => sent.push(JSON.parse(payload) as Record<string, unknown>),
    close: vi.fn(),
    on: (event: string, handler: (raw: string) => void) => {
      if (event === 'message') onMessage = handler;
    },
  } as unknown as WebSocket;
  return {
    socket,
    sent,
    /** Deliver a frame and let the gateway's async handler settle. */
    deliver: async (payload: unknown) => {
      onMessage?.(JSON.stringify(payload));
      await new Promise((r) => setImmediate(r));
    },
    /** Deliver bytes verbatim — the only way to test a frame that is not JSON at all. */
    deliverRaw: async (raw: string) => {
      onMessage?.(raw);
      await new Promise((r) => setImmediate(r));
    },
    of: (type: string) => sent.filter((m) => m.type === type),
  };
}

const request = (query: string) => ({ url: `/api/whiteboard/live?${query}` }) as IncomingMessage;

describe('BoardGateway', () => {
  let gateway: BoardGateway;
  let boards: BoardDocService;
  let canWrite: boolean;
  let tokenValid: boolean;
  let watched: string[];

  beforeEach(() => {
    canWrite = true;
    tokenValid = true;
    watched = [];

    boards = new BoardDocService();
    boards.bind({
      load: async () => ({ elements: [], appState: {} }),
      save: async () => undefined,
    });
    const realWatch = boards.watch.bind(boards);
    boards.watch = (id: string) => {
      watched.push(id);
      realWatch(id);
    };

    const auth = {
      verifyToken: async () => {
        if (!tokenValid) throw new Error('That token is not valid');
        return actor;
      },
    } as unknown as AuthGuard;

    const users = { byId: async () => ({ displayName: 'Robin' }) } as unknown as UserService;

    const whiteboards = {
      get: async () => ({ id: 'b1' }),
      assertCanWrite: async () => {
        if (!canWrite) throw new Error('Missing capability whiteboard.write');
      },
    } as unknown as WhiteboardService;

    gateway = new BoardGateway(auth, users, whiteboards, boards);
  });

  describe('connecting', () => {
    it('sends the scene and who else is on it', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));

      const [init] = a.of('init');
      expect(init).toMatchObject({ boardId: 'b1', elements: [], peers: [] });
      expect(init?.self).toMatchObject({ name: 'Robin', userId: actor.userId });
    });

    it('gives everyone on a board the same colour for the same person', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));
      const first = (a.of('init')[0]?.self as { colour: number }).colour;

      const b = fakeSocket();
      await gateway.handleConnection(b.socket, request('token=t&boardId=b1'));
      const second = (b.of('init')[0]?.self as { colour: number }).colour;

      // Derived from the user id, so it survives a reconnect. A join-order colour would not.
      expect(second).toBe(first);
    });

    it.each([
      ['no token', 'boardId=b1'],
      ['no board', 'token=t'],
    ])('refuses a connection with %s', async (_label, query) => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request(query));

      expect(a.of('error')).toHaveLength(1);
      expect(a.socket.close).toHaveBeenCalled();
      // Nothing may be held open on behalf of a connection that was never allowed.
      expect(watched).toEqual([]);
    });

    it('refuses a bad token and holds nothing', async () => {
      tokenValid = false;
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=nope&boardId=b1'));

      expect(a.of('error')[0]?.message).toMatch(/not valid/);
      expect(watched).toEqual([]);
    });

    it('refuses someone who may read but not draw, at connect rather than at first stroke', async () => {
      canWrite = false;
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));

      // Allowed through, the refusal would surface much later as a board that silently
      // stops saving.
      expect(a.of('error')[0]?.message).toMatch(/whiteboard.write/);
      expect(a.socket.close).toHaveBeenCalled();
    });
  });

  describe('updates', () => {
    it('reaches every peer on the board, the sender included', async () => {
      const a = fakeSocket();
      const b = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));
      await gateway.handleConnection(b.socket, request('token=t&boardId=b1'));

      await a.deliver({ type: 'update', elements: [el('x')] });

      // The sender is told too: if its element had LOST the merge it must learn the winner,
      // or it holds a board nobody else has.
      expect(a.of('update')[0]?.elements).toHaveLength(1);
      expect(b.of('update')[0]?.elements).toHaveLength(1);
    });

    it('never leaks one board to another', async () => {
      const a = fakeSocket();
      const other = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));
      await gateway.handleConnection(other.socket, request('token=t&boardId=b2'));

      await a.deliver({ type: 'update', elements: [el('x')] });

      expect(other.of('update')).toHaveLength(0);
    });

    it('refuses a batch bigger than one message may carry, rather than truncating it', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));

      await a.deliver({
        type: 'update',
        elements: Array.from({ length: 5_001 }, (_, i) => el(`e${i}`)),
      });

      // Silently dropping half of what somebody pasted is worse than saying it did not land.
      expect(a.of('error')[0]?.message).toMatch(/At most 5000/);
      expect(a.of('update')).toHaveLength(0);
    });

    it('refuses elements that are not an array', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));

      await a.deliver({ type: 'update', elements: 'everything' });

      expect(a.of('error')[0]?.message).toMatch(/must be an array/);
    });
  });

  describe('pointers', () => {
    it('relays a cursor to the others but not back to its owner', async () => {
      const a = fakeSocket();
      const b = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));
      await gateway.handleConnection(b.socket, request('token=t&boardId=b1'));

      await a.deliver({ type: 'pointer', x: 10, y: 20 });

      expect(b.of('pointer')[0]).toMatchObject({ x: 10, y: 20, tool: 'pointer' });
      expect(a.of('pointer')).toHaveLength(0);
    });

    it('does not mark the board as needing a write', async () => {
      const a = fakeSocket();
      const b = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));
      await gateway.handleConnection(b.socket, request('token=t&boardId=b1'));

      let saved = false;
      boards.bind({
        load: async () => ({ elements: [], appState: {} }),
        save: async () => {
          saved = true;
        },
      });
      await a.deliver({ type: 'pointer', x: 1, y: 2 });
      await boards.flush('b1');

      // A cursor moving is not a change to the drawing.
      expect(saved).toBe(false);
    });

    it('says nothing at all when nobody else is on the board', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));

      await a.deliver({ type: 'pointer', x: 1, y: 2 });

      expect(a.of('pointer')).toHaveLength(0);
    });
  });

  describe('presence', () => {
    it('tells the room when somebody joins and when they leave', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));

      const b = fakeSocket();
      await gateway.handleConnection(b.socket, request('token=t&boardId=b1'));
      expect((a.of('presence').at(-1)?.peers as unknown[]).length).toBe(1);

      gateway.handleDisconnect(b.socket);
      expect((a.of('presence').at(-1)?.peers as unknown[]).length).toBe(0);
    });
  });

  describe('resilience', () => {
    it('refuses a frame that is not JSON without killing the connection', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));

      await a.deliverRaw('{"type": "update", elements');

      expect(a.of('error')[0]?.message).toMatch(/Expected JSON/);
      expect(a.socket.close).not.toHaveBeenCalled();

      // And the connection still works afterwards — one bad frame is not a lost session.
      await a.deliver({ type: 'update', elements: [el('x')] });
      expect(a.of('update')).toHaveLength(1);
    });

    it('ignores a frame it has no handler for', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));

      await a.deliver({ type: 'something-we-added-later' });

      expect(a.of('error')).toHaveLength(0);
      expect(a.socket.close).not.toHaveBeenCalled();
    });

    it('sends the whole scene again on pull, for a client that reconnected', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));
      await a.deliver({ type: 'update', elements: [el('x')] });

      await a.deliver({ type: 'pull' });

      const latest = a.of('init').at(-1);
      expect((latest?.elements as unknown[]).map((e) => (e as BoardElement).id)).toEqual(['x']);
    });

    it('stops holding the board once the last person leaves', async () => {
      const a = fakeSocket();
      await gateway.handleConnection(a.socket, request('token=t&boardId=b1'));
      await a.deliver({ type: 'update', elements: [el('x')] });

      gateway.handleDisconnect(a.socket);

      // Not released — a reload should not have to rehydrate the whole scene — but no longer
      // pinned against the idle sweep either.
      boards.sweep(Date.now() + 6 * 60_000);
      const snapshot = await boards.snapshot('b1');
      expect(snapshot.elements).toEqual([]);
    });
  });
});
