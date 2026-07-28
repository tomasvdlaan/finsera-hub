import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { WebSocket } from 'ws';
import { LiveRegistry } from './live-registry.service.js';
import { RecallSession } from './capture/recall.provider.js';

/**
 * Where Recall delivers audio.
 *
 * This endpoint is on the public internet — it has to be, because Recall connects to us
 * from its own servers rather than the reverse. Recall presents no credentials of its
 * own, so the only thing standing between a stranger and a client's meeting notes is the
 * per-session token minted when the bot was created. Treat this file as security-relevant.
 */
@WebSocketGateway({ path: '/api/meetings/recall' })
export class RecallGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RecallGateway.name);

  constructor(private readonly sessions: LiveRegistry) {}

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? '', 'http://localhost');
    const noteId = url.searchParams.get('noteId');
    const token = url.searchParams.get('token');

    if (!noteId || !token) {
      this.logger.warn('Rejected a stream with no note or token');
      return socket.close();
    }

    const entry = this.sessions.get(noteId);
    const capture = entry?.capture;
    if (!(capture instanceof RecallSession)) {
      // No session is waiting: either the meeting already ended, or this is somebody
      // guessing. Either way there is nothing to attach to.
      this.logger.warn(`Rejected a stream for an unknown session (${noteId})`);
      return socket.close();
    }

    if (!matches(token, capture.streamToken)) {
      this.logger.error(`Rejected a stream with a bad token for note ${noteId}`);
      return socket.close();
    }

    this.logger.log(`Recall stream attached for note ${noteId}`);
    capture.attach(socket);
  }
}

/** Constant-time compare, so a wrong token cannot be found one character at a time. */
function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
