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
import { RegistryService } from '../../../core/registry/registry.service.js';
import { MeetingsService } from '../meetings.service.js';
import { LiveRegistry } from './live-registry.service.js';
import { LiveService } from './live.service.js';
import { LiveSession } from './live-session.js';

interface Client {
  socket: WebSocket;
  session: LiveSession;
  actor: Actor;
}

/**
 * The live meeting socket.
 *
 * The platform's first WebSocket, and the first place audio enters it. What that audio
 * does NOT do is get written down: segments are transcribed and dropped, and nothing but
 * text ever reaches the database.
 *
 * Protocol, deliberately small:
 *   client → { type: 'audio', mimeType, data }  base64 segment, ~25s, self-contained
 *   client → { type: 'stop' }
 *   server → { type: 'ready' | 'line' | 'proposals' | 'state' | 'cost' | 'error' | 'stopped' }
 */
@WebSocketGateway({ path: '/api/meetings/live' })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);
  private readonly clients = new Map<WebSocket, Client>();

  constructor(
    private readonly auth: AuthGuard,
    private readonly registry: RegistryService,
    private readonly meetings: MeetingsService,
    private readonly live: LiveService,
    private readonly sessions: LiveRegistry,
  ) {}

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    try {
      const url = new URL(request.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      const noteId = url.searchParams.get('noteId');
      if (!token || !noteId) throw new Error('A token and noteId are required');

      // Same verification as every HTTP request; a socket is not a way around auth.
      const actor = await this.auth.verifyToken(token);
      const note = await this.meetings.get(actor, noteId);

      // The consent gate. Not advisory: without every attendee having agreed, the socket
      // closes before a single byte of audio is accepted.
      if (!note.everyoneConsented) {
        throw new Error(
          'Every attendee must be recorded as having consented before a meeting can be transcribed',
        );
      }

      // A bot session may already be running for this note — started over REST, with
      // audio arriving from Recall. In that case the browser is a watcher, not a source.
      const running = this.sessions.get(noteId);
      if (running) {
        this.sessions.watch(noteId, socket as never);
        socket.on('close', () => this.sessions.unwatch(noteId, socket as never));
        this.send(socket, {
          type: 'ready',
          noteId,
          mode: 'watching',
          startedAt: running.live.startedAt.toISOString(),
        });
        return;
      }

      const session = new LiveSession(noteId, actor.userId);
      this.clients.set(socket, { socket, session, actor });
      this.send(socket, { type: 'ready', noteId, startedAt: session.startedAt.toISOString() });
      this.logger.log(`Live session started for note ${noteId}`);

      socket.on('message', (raw: Buffer) => void this.onMessage(socket, raw));
    } catch (error) {
      this.send(socket, { type: 'error', message: (error as Error).message });
      socket.close();
    }
  }

  async handleDisconnect(socket: WebSocket): Promise<void> {
    const client = this.clients.get(socket);
    if (!client) return;
    this.clients.delete(socket);
    // A dropped connection still saves what was said — a meeting that crashed the tab
    // should not also lose its notes.
    await this.persist(client).catch((error) =>
      this.logger.error(`Could not save live session: ${(error as Error).message}`),
    );
  }

  private async onMessage(socket: WebSocket, raw: Buffer): Promise<void> {
    const client = this.clients.get(socket);
    if (!client) return;

    let message: { type: string; mimeType?: string; data?: string };
    try {
      message = JSON.parse(raw.toString()) as typeof message;
    } catch {
      return this.send(socket, { type: 'error', message: 'Malformed message' });
    }

    if (message.type === 'stop') {
      await this.persist(client);
      this.send(socket, {
        type: 'stopped',
        costCents: this.live.costCents(client.session),
        lines: client.session.lines.length,
      });
      this.clients.delete(socket);
      socket.close();
      return;
    }

    if (message.type !== 'audio' || !message.data) return;

    try {
      const audio = Buffer.from(message.data, 'base64');
      const text = await this.live.transcribeSegment(
        client.session,
        audio,
        message.mimeType ?? 'audio/webm',
      );
      // The buffer goes out of scope here and is never written anywhere.

      const line = client.session.addLine(text);
      if (line) this.send(socket, { type: 'line', line });
      this.send(socket, { type: 'cost', costCents: this.live.costCents(client.session) });

      if (client.session.shouldExtract()) void this.tick(client);
    } catch (error) {
      // A failed segment loses a few seconds of transcript; it must not end the meeting.
      this.logger.warn(`Segment failed: ${(error as Error).message}`);
      this.send(socket, { type: 'error', message: 'A segment could not be transcribed' });
    }
  }

  /** One extraction pass over the rolling window. Never blocks incoming audio. */
  private async tick(client: Client): Promise<void> {
    const { session, socket, actor } = client;
    session.extracting = true;
    try {
      const note = await this.meetings.get(actor, session.noteId);
      const { added, state } = await this.live.extract(
        session,
        note.agenda.map((a) => ({ id: a.id, title: a.title, covered: a.covered })),
        () => this.registry.newId(),
      );
      if (added.length > 0) this.send(socket, { type: 'proposals', proposals: added });
      this.send(socket, { type: 'state', state });
      this.send(socket, { type: 'cost', costCents: this.live.costCents(session) });
    } catch (error) {
      this.logger.warn(`Extraction failed: ${(error as Error).message}`);
    } finally {
      session.extracting = false;
    }
  }

  /**
   * Write what the meeting produced.
   *
   * The transcript is appended to the note body and open proposals become action points
   * in the PROPOSED state — the same state a typed one starts in, so accepting them uses
   * the path that already exists rather than a special one.
   */
  private async persist(client: Client): Promise<void> {
    const { session, actor } = client;
    if (session.lines.length === 0) return;

    const note = await this.meetings.get(actor, session.noteId);
    const transcript = session.lines.map((l) => `${formatClock(l.at)} ${l.text}`).join('\n');

    const body = [
      note.body.trim(),
      session.state.summary ? `\n## Summary\n\n${session.state.summary}` : '',
      session.state.decisions.length > 0
        ? `\n## Decisions\n\n${session.state.decisions.map((d) => `- ${d}`).join('\n')}`
        : '',
      session.state.openQuestions.length > 0
        ? `\n## Open questions\n\n${session.state.openQuestions.map((q) => `- ${q}`).join('\n')}`
        : '',
      `\n## Transcript\n\n${transcript}`,
    ]
      .filter(Boolean)
      .join('\n');

    await this.meetings.update(actor, session.noteId, { body });

    for (const proposal of session.openProposals) {
      if (proposal.kind === 'action') {
        await this.meetings.addActionItem(actor, session.noteId, {
          text: proposal.text,
          source: 'ai',
        });
      }
    }

    await this.meetings.recordTranscription(actor, session.noteId, {
      tokens: session.tokensIn + session.tokensOut,
      costCents: this.live.costCents(session),
      durationSeconds: session.durationSeconds,
    });
  }

  private send(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  }
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
}
