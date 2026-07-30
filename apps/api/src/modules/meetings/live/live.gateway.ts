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
import { LiveRunner } from './live-runner.service.js';
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
 * Protocol. Small on the way in, less so on the way out:
 *
 *   client → { type: 'audio', mimeType, data }  base64 segment, ~25s, self-contained
 *   client → { type: 'stop' }
 *
 *   server → ready      { noteId, startedAt } — or { mode: 'watching' } for a second tab
 *   server → line       { line: TranscriptLine }
 *   server → proposals  { proposals: Proposal[] }
 *   server → state      { state: { summary, decisions, openQuestions } }
 *   server → notes      { markdown } — the note-taker's section, rewritten each pass
 *   server → cost       { costCents }
 *   server → speaker    { speaker, event }
 *   server → attendees  { attendees, unconsentedPresent }
 *   server → spoke      { text } — what the assistant said aloud
 *   server → error      { message } — one bad segment, not the end of the meeting
 *   server → ended      { reason } — the capture provider dropped
 *   server → stopped    { costCents, lines } — written and saved
 *
 * This list said seven for a while and the server sent twelve, which is a bad way to write a
 * second client. The web reducer in liveMeetingReducer.ts handles all of them and ignores
 * anything unknown, so an older tab survives a newer server.
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
    private readonly runner: LiveRunner,
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

      /*
       * On the register, like a bot session.
       *
       * It was not, and that was the reason behaviours could not run here: they report
       * what they did by broadcasting to a note's watchers, and an unregistered session
       * has no watchers to reach. Registering also means this note now counts as being
       * captured, so a bot cannot be sent into a meeting the microphone is already
       * recording — which was previously allowed and produced two sessions writing the
       * same note.
       */
      this.sessions.start(noteId, session);
      this.sessions.watch(noteId, socket as never);
      await this.meetings.stampSession(actor, noteId, { startedAt: session.startedAt });
      this.runner.startBehaviours(actor, noteId, session);

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
    await this.finish(client).catch((error) =>
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
      this.clients.delete(socket);
      // runner.stop pushes 'stopped' to this socket itself, as a watcher, so there is no
      // second message from here that could disagree with it.
      await this.finish(client);
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
      // Broadcast rather than sent: a second tab watching this note is a watcher now, and
      // it should see the same transcript as the tab holding the microphone.
      if (line) this.sessions.broadcast(client.session.noteId, { type: 'line', line });
      this.sessions.broadcast(client.session.noteId, {
        type: 'cost',
        costCents: this.live.costCents(client.session),
      });

      if (client.session.shouldExtract()) void this.tick(client);
      if (line) {
        void this.runner.onUtterance(client.actor, client.session.noteId, client.session, {
          speaker: line.speaker,
          text: line.text,
          at: line.at,
        });
      }
    } catch (error) {
      // A failed segment loses a few seconds of transcript; it must not end the meeting.
      this.logger.warn(`Segment failed: ${(error as Error).message}`);
      this.send(socket, { type: 'error', message: 'A segment could not be transcribed' });
    }
  }

  /** One extraction pass over the rolling window. Never blocks incoming audio. */
  private async tick(client: Client): Promise<void> {
    const { session, actor } = client;
    session.extracting = true;
    try {
      const note = await this.meetings.get(actor, session.noteId);
      const { added, state } = await this.live.extract(
        session,
        note.agenda.map((a) => ({ id: a.id, title: a.title, covered: a.covered })),
        () => this.registry.newId(),
      );
      if (added.length > 0) {
        this.sessions.broadcast(session.noteId, { type: 'proposals', proposals: added });
      }
      this.sessions.broadcast(session.noteId, { type: 'state', state });
      this.sessions.broadcast(session.noteId, {
        type: 'cost',
        costCents: this.live.costCents(session),
      });
    } catch (error) {
      this.logger.warn(`Extraction failed: ${(error as Error).message}`);
    } finally {
      session.extracting = false;
    }
  }

  /**
   * End the meeting, through the one function that ends meetings.
   *
   * This used to be a second implementation of LiveRunner.stop — it wrote the body, made
   * action points and recorded the cost, in its own slightly different way, and it knew
   * nothing about behaviour timers or conversation state because the socket path had
   * none. Now that the session is registered, there is nothing left for it to do
   * differently, and the difference was never a feature.
   *
   * The registry removes the session synchronously before any awaiting, so a failure
   * while writing cannot leave the note permanently marked as being captured.
   */
  private async finish(client: Client): Promise<void> {
    await this.runner.stop(client.actor, client.session.noteId);
  }

  private send(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  }
}

