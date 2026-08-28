import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { MAX_ELEMENTS_PER_MESSAGE } from '@platform/board-doc';
import type { Actor } from '@platform/contracts';
import { AuthGuard } from '../../../core/auth/auth.guard.js';
import { UserService } from '../../../core/auth/user.service.js';
import { WhiteboardService } from '../whiteboard.service.js';
import { BoardDocService } from './board-doc.service.js';

interface Peer {
  socket: WebSocket;
  boardId: string;
  actor: Actor;
  /** This connection's name for itself. Unlike a note editor, a board peer IS its socket. */
  clientId: string;
  name: string;
  colour: number;
}

/**
 * A person's colour, derived from who they are rather than when they joined.
 *
 * The same hash the avatars use, so the cursor following you round a board is the colour your
 * face already is — and it survives a reconnect, which a join-order colour would not.
 */
function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

/**
 * The collaborative whiteboard socket.
 *
 * Protocol:
 *
 *   client → { type: 'update', elements }   what this client changed
 *   client → { type: 'pointer', x, y, tool, selectedIds }   ephemeral; never persisted
 *   client → { type: 'pull' }               the whole scene again, after a reconnect
 *   client → { type: 'appState', appState } background colour, grid
 *
 *   server → init      { boardId, elements, appState, self, peers }
 *   server → update    { elements }   what the merge accepted
 *   server → pointer   { clientId, x, y, tool, selectedIds }
 *   server → presence  { peers }
 *   server → appState  { appState }
 *   server → error     { message }
 *
 * **`update` goes to everyone, the sender included** — the opposite of what looks efficient,
 * and deliberate. If the sender's element LOST the merge it has to be told the winner, or it
 * holds a version of the board nobody else has, for ever. The alternatives are a second message
 * type for corrections (a separate code path, and the one that gets tested least) or letting a
 * peer diverge silently. Echoing costs nothing: an element that won comes back at the same
 * version and nonce, where the merge is a no-op.
 *
 * There is no `behind` and no `reload`. Last-writer-wins per element is commutative and
 * idempotent, so message order does not matter and a client cannot fall behind — see
 * BoardDocService for why that deletes most of what the note socket needs.
 */
@WebSocketGateway({ path: '/api/whiteboard/live' })
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BoardGateway.name);
  private readonly peers = new Map<WebSocket, Peer>();
  private nextClientId = 1;

  constructor(
    private readonly auth: AuthGuard,
    private readonly users: UserService,
    private readonly whiteboards: WhiteboardService,
    private readonly boards: BoardDocService,
  ) {
    // One subscription for the whole gateway rather than one per socket.
    this.boards.onChange((change) => {
      this.broadcast(change.boardId, { type: 'update', elements: change.elements });
    });
  }

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    try {
      const url = new URL(request.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      const boardId = url.searchParams.get('boardId');
      if (!token || !boardId) throw new Error('A token and boardId are required');

      // Same verification as every HTTP request; a socket is not a way around auth.
      const actor = await this.auth.verifyToken(token);
      await this.whiteboards.get(actor, boardId);
      // Checked now rather than when the first stroke is eventually flushed — otherwise a
      // refusal surfaces as a board that quietly stops saving.
      await this.whiteboards.assertCanWrite(actor);

      const user = await this.users.byId(actor.userId);
      const peer: Peer = {
        socket,
        boardId,
        actor,
        clientId: `c${this.nextClientId++}`,
        name: (user?.displayName as string | undefined) ?? 'Someone',
        colour: hueFor(actor.userId),
      };
      this.peers.set(socket, peer);
      this.boards.watch(boardId);

      const snapshot = await this.boards.snapshot(boardId);
      this.send(socket, {
        type: 'init',
        boardId,
        elements: snapshot.elements,
        appState: snapshot.appState,
        self: this.describe(peer),
        peers: this.peersOn(boardId, peer).map((p) => this.describe(p)),
      });
      this.announcePresence(boardId);

      socket.on('message', (raw: Buffer | string) => void this.onMessage(socket, raw));
    } catch (error) {
      this.send(socket, { type: 'error', message: (error as Error).message });
      socket.close();
    }
  }

  handleDisconnect(socket: WebSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    this.boards.unwatch(peer.boardId);
    this.announcePresence(peer.boardId);

    /*
     * Flush when the last person on the board leaves.
     *
     * Not release: the idle sweep lets it go once nothing has touched it for a while, which
     * means somebody who reloads their tab does not pay to rehydrate the whole scene.
     */
    if (this.peersOn(peer.boardId).length === 0) {
      void this.boards.flush(peer.boardId).catch(() => undefined);
    }
  }

  private async onMessage(socket: WebSocket, raw: Buffer | string): Promise<void> {
    const peer = this.peers.get(socket);
    if (!peer) return;

    let message: {
      type?: string;
      elements?: unknown[];
      appState?: Record<string, unknown>;
      x?: number;
      y?: number;
      tool?: string;
      selectedIds?: string[];
    };
    try {
      message = JSON.parse(raw.toString()) as typeof message;
    } catch {
      return this.send(socket, { type: 'error', message: 'Expected JSON' });
    }

    try {
      if (message.type === 'pointer') {
        /*
         * Relayed and forgotten. A cursor moving is not a change to the board: it must never
         * mark anything dirty, schedule a flush, or keep the scene resident in memory.
         */
        if (this.peersOn(peer.boardId, peer).length === 0) return;
        return this.broadcast(
          peer.boardId,
          {
            type: 'pointer',
            clientId: peer.clientId,
            x: message.x,
            y: message.y,
            tool: message.tool === 'laser' ? 'laser' : 'pointer',
            selectedIds: message.selectedIds ?? [],
          },
          peer,
        );
      }

      if (message.type === 'pull') {
        const snapshot = await this.boards.snapshot(peer.boardId);
        return this.send(socket, {
          type: 'init',
          boardId: peer.boardId,
          elements: snapshot.elements,
          appState: snapshot.appState,
          self: this.describe(peer),
          peers: this.peersOn(peer.boardId, peer).map((p) => this.describe(p)),
        });
      }

      if (message.type === 'appState') {
        if (!message.appState) return;
        await this.boards.setAppState(peer.boardId, message.appState, peer.actor);
        return this.broadcast(
          peer.boardId,
          { type: 'appState', appState: message.appState },
          peer,
        );
      }

      if (message.type === 'update') {
        if (!Array.isArray(message.elements)) {
          return this.send(socket, { type: 'error', message: '`elements` must be an array' });
        }
        if (message.elements.length > MAX_ELEMENTS_PER_MESSAGE) {
          // Refused rather than truncated: silently dropping half of what somebody pasted is
          // worse than telling them it did not land.
          return this.send(socket, {
            type: 'error',
            message: `At most ${MAX_ELEMENTS_PER_MESSAGE} elements per message`,
          });
        }
        // Accepted elements reach this socket through the change listener, like everyone
        // else's — see the note on echoing above.
        await this.boards.apply(peer.boardId, {
          elements: message.elements,
          actor: peer.actor,
          from: peer.clientId,
        });
        return;
      }
    } catch (error) {
      this.logger.warn(`Board ${peer.boardId}: ${(error as Error).message}`);
      this.send(socket, { type: 'error', message: (error as Error).message });
    }
  }

  private describe(peer: Peer) {
    return { clientId: peer.clientId, userId: peer.actor.userId, name: peer.name, colour: peer.colour };
  }

  private peersOn(boardId: string, except?: Peer): Peer[] {
    const found: Peer[] = [];
    for (const peer of this.peers.values()) {
      if (peer.boardId === boardId && peer !== except) found.push(peer);
    }
    return found;
  }

  private announcePresence(boardId: string): void {
    const all = this.peersOn(boardId);
    for (const peer of all) {
      this.send(peer.socket, {
        type: 'presence',
        peers: all.filter((p) => p !== peer).map((p) => this.describe(p)),
      });
    }
  }

  private broadcast(boardId: string, payload: unknown, except?: Peer): void {
    for (const peer of this.peersOn(boardId, except)) this.send(peer.socket, payload);
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify(payload));
  }
}
