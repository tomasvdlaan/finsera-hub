import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { Actor } from '@platform/contracts';
import { AuthGuard } from '../../../core/auth/auth.guard.js';
import { MeetingsService } from '../meetings.service.js';
import { NoteDocService } from './note-doc.service.js';

interface Editor {
  socket: WebSocket;
  noteId: string;
  actor: Actor;
  /** Identifies this connection's steps so it can recognise its own coming back. */
  clientId: string;
}

/**
 * The collaborative note socket.
 *
 * Separate from the live meeting socket on purpose. Notes are edited far more often than
 * they are recorded — before a meeting, after one, and on notes that were never a recording
 * at all — so tying editing to the meeting socket would mean either opening a capture
 * session to type, or growing a second protocol inside the first. The live socket carries
 * audio and what the assistant heard; this one carries the document.
 *
 * Protocol:
 *
 *   client → { type: 'steps', version, steps }   changes based on `version`
 *   client → { type: 'pull', version }           catch up after a reconnect
 *
 *   server → init    { version, doc, clientId }  the document, and who you are
 *   server → steps   { version, steps, clientIds }
 *                    Broadcast to everyone including the sender — prosemirror-collab
 *                    recognises its own clientIds and uses them to confirm, so sending only
 *                    to others would leave the author's changes forever unacknowledged.
 *   server → behind  { version }                 your steps were stale; pull and retry
 *   server → reload  { }                         too far behind to catch up
 *   server → error   { message }
 *
 * There is no `save`. The authority writes the body out a second after the last change, and
 * anything that needs it on disk right now calls flush.
 */
@WebSocketGateway({ path: '/api/meetings/doc' })
export class DocGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DocGateway.name);
  private readonly editors = new Map<WebSocket, Editor>();
  private nextClientId = 1;

  constructor(
    private readonly auth: AuthGuard,
    private readonly meetings: MeetingsService,
    private readonly docs: NoteDocService,
  ) {
    // One subscription for the whole gateway rather than one per socket: changes arrive from
    // the assistant and the note-taking behaviour too, not only from someone typing.
    this.docs.onChange((change) => {
      this.broadcast(change.noteId, {
        type: 'steps',
        version: change.version,
        steps: change.steps.map((s) => s.toJSON()),
        clientIds: change.clientIds,
      });
    });
  }

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    try {
      const url = new URL(request.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      const noteId = url.searchParams.get('noteId');
      if (!token || !noteId) throw new Error('A token and noteId are required');

      // Same verification as every HTTP request; a socket is not a way around auth.
      const actor = await this.auth.verifyToken(token);
      await this.meetings.get(actor, noteId);
      // Checked now rather than when the body is eventually written — see assertCanWrite.
      await this.meetings.assertCanWrite(actor);

      const clientId = `c${this.nextClientId++}`;
      this.editors.set(socket, { socket, noteId, actor, clientId });
      this.docs.watch(noteId);

      const snapshot = await this.docs.snapshot(noteId);
      this.send(socket, {
        type: 'init',
        clientId,
        version: snapshot.version,
        doc: snapshot.doc,
      });

      socket.on('message', (raw: Buffer | string) => void this.onMessage(socket, raw));
    } catch (error) {
      this.send(socket, { type: 'error', message: (error as Error).message });
      socket.close();
    }
  }

  handleDisconnect(socket: WebSocket): void {
    const editor = this.editors.get(socket);
    if (!editor) return;
    this.editors.delete(socket);
    this.docs.unwatch(editor.noteId);

    /*
     * Flush when the last person editing this note leaves.
     *
     * Not release: a meeting behaviour may still be writing into it, and dropping the
     * document would restart it from whatever was last saved. The idle sweep lets it go once
     * nothing has touched it for a while.
     */
    if (!this.anyoneOn(editor.noteId)) {
      void this.docs.flush(editor.noteId).catch(() => undefined);
    }
  }

  private async onMessage(socket: WebSocket, raw: Buffer | string): Promise<void> {
    const editor = this.editors.get(socket);
    if (!editor) return;

    let message: { type?: string; version?: number; steps?: unknown[] };
    try {
      message = JSON.parse(raw.toString()) as typeof message;
    } catch {
      return this.send(socket, { type: 'error', message: 'Expected JSON' });
    }

    try {
      if (message.type === 'pull') {
        const missed = await this.docs.since(editor.noteId, message.version ?? 0);
        if (!missed) return this.send(socket, { type: 'reload' });
        return this.send(socket, {
          type: 'steps',
          version: missed.version,
          steps: missed.steps.map((s) => s.toJSON()),
          clientIds: missed.clientIds,
        });
      }

      if (message.type === 'steps') {
        const result = await this.docs.apply(editor.noteId, {
          version: message.version ?? -1,
          steps: message.steps ?? [],
          clientId: editor.clientId,
          actor: editor.actor,
        });
        // Accepted steps reach this socket through the change listener, like everyone else's.
        if (result.ok) return;
        if (result.reason === 'behind') {
          const current = await this.docs.snapshot(editor.noteId);
          return this.send(socket, { type: 'behind', version: current.version });
        }
        return this.send(socket, { type: 'error', message: 'That change could not be applied' });
      }
    } catch (error) {
      this.logger.warn(`Note ${editor.noteId}: ${(error as Error).message}`);
      this.send(socket, { type: 'error', message: (error as Error).message });
    }
  }

  private anyoneOn(noteId: string): boolean {
    for (const editor of this.editors.values()) if (editor.noteId === noteId) return true;
    return false;
  }

  private broadcast(noteId: string, payload: unknown): void {
    for (const editor of this.editors.values()) {
      if (editor.noteId === noteId) this.send(editor.socket, payload);
    }
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify(payload));
  }
}
