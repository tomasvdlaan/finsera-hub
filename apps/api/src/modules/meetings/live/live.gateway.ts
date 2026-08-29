import { Logger, type OnModuleDestroy } from '@nestjs/common';
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
 * How long a meeting waits for its audio source to come back.
 *
 * A page reload closes the socket and reopens it about a second later; closing the tab never
 * reopens it. Nothing on the wire tells the two apart, so the difference is time. Long enough
 * to cover a slow reload, short enough that a genuinely abandoned meeting is written down
 * while anyone still remembers it.
 */
const RECONNECT_GRACE_MS = 45_000;

/** Read per call so a test can shorten it, and so it can be tuned without a rebuild. */
const graceMs = (): number => Number(process.env.LIVE_RECONNECT_GRACE_MS ?? RECONNECT_GRACE_MS);

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
 * Pause is deliberately NOT on this socket: it is a property of the meeting rather than of one
 * tab's connection, every other tab has to hear about it, and it has to work from a phone that
 * is not the one holding the microphone. It is POST /meetings/:id/live/pause, and the result
 * arrives here as `paused` for everybody.
 *
 *   server → ready      { noteId, startedAt, mode: 'source' | 'watching', source? }
 *                       'source' means this socket is expected to send audio; a second tab
 *                       on the same meeting, or any tab watching a bot, gets 'watching'.
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
 *   server → listening  { paused } — whether the agent is listening. State rather than an
 *                       event, so a tab that connects mid-pause is told the same thing as one
 *                       that watched it happen.
 *   server → stopped    { costCents, lines } — written and saved
 *
 * This list said seven for a while and the server sent twelve, which is a bad way to write a
 * second client. The web reducer in liveMeetingReducer.ts handles all of them and ignores
 * anything unknown, so an older tab survives a newer server.
 */
@WebSocketGateway({ path: '/api/meetings/live' })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(LiveGateway.name);
  private readonly clients = new Map<WebSocket, Client>();
  /** Sessions waiting for their source to return, by note id. */
  private readonly pendingFinish = new Map<string, ReturnType<typeof setTimeout>>();

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

      const running = this.sessions.get(noteId);

      /*
       * A session waiting for its audio source: take it over rather than watch it.
       *
       * This is the reload case. The tab that was recording closed its socket on unload, the
       * session was held open instead of finalised, and this is the same tab coming back a
       * second later. It becomes the source again and the meeting continues, rather than the
       * page reporting a meeting that its own refresh ended.
       */
      if (running && this.sessions.isOrphaned(noteId)) {
        this.cancelFinish(noteId);
        this.sessions.adopt(noteId);
        this.clients.set(socket, { socket, session: running.live, actor });
        this.sessions.watch(noteId, socket as never);
        this.send(socket, {
          type: 'ready',
          noteId,
          mode: 'source',
          source: running.live.source,
          startedAt: running.live.startedAt.toISOString(),
        });
        socket.on('message', (raw: Buffer) =>
          // Returned rather than voided. `ws` ignores it, but `void` on a rejecting promise is
          // an unhandled rejection that surfaces as a process warning at best — and it left a
          // test no way to know the handler had finished except to guess at a duration.
          this.onMessage(socket, raw).catch((error: unknown) =>
            this.logger.error(`Live message failed: ${String(error)}`),
          ),
        );
        this.logger.log(`Live session for ${noteId} picked back up`);
        return;
      }

      // Otherwise a session that is already being fed — a bot, or another tab holding the
      // microphone. This browser is a watcher, not a source.
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

      const kind = url.searchParams.get('source') === 'tab' ? 'tab' : 'microphone';
      const session = new LiveSession(noteId, actor.userId, new Date(), kind);
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

      this.send(socket, {
        type: 'ready',
        noteId,
        mode: 'source',
        source: session.source,
        startedAt: session.startedAt.toISOString(),
      });
      this.logger.log(`Live session started for note ${noteId}`);

      socket.on('message', (raw: Buffer) =>
          // Returned rather than voided. `ws` ignores it, but `void` on a rejecting promise is
          // an unhandled rejection that surfaces as a process warning at best — and it left a
          // test no way to know the handler had finished except to guess at a duration.
          this.onMessage(socket, raw).catch((error: unknown) =>
            this.logger.error(`Live message failed: ${String(error)}`),
          ),
        );
    } catch (error) {
      this.send(socket, { type: 'error', message: (error as Error).message });
      socket.close();
    }
  }

  /**
   * The audio source went away. Wait for it before writing the meeting off.
   *
   * This used to finalise immediately, which made a page refresh end the meeting: the browser
   * closes its socket on unload, and to the server that was indistinguishable from the tab
   * closing for good. The session is held open for a moment instead, and a socket returning
   * within the window takes it back over.
   *
   * Still safe if nothing returns — the timer finalises exactly what the immediate call used
   * to, so a crashed tab loses at most the grace window rather than the meeting.
   */
  async handleDisconnect(socket: WebSocket): Promise<void> {
    const client = this.clients.get(socket);
    if (!client) return;
    const { noteId } = client.session;
    this.clients.delete(socket);
    this.sessions.unwatch(noteId, socket as never);

    this.sessions.orphan(noteId);
    const timer = setTimeout(() => {
      this.pendingFinish.delete(noteId);
      // Only if nobody came back. A returning socket clears both the timer and the orphan.
      if (!this.sessions.isOrphaned(noteId)) return;
      void this.finish(client).catch((error) =>
        this.logger.error(`Could not save live session: ${(error as Error).message}`),
      );
    }, graceMs());
    // Not unref'd: this timer is the only thing that will ever write the meeting down.
    this.pendingFinish.set(noteId, timer);
  }

  /**
   * Disarm every pending finish.
   *
   * A grace timer outlives whatever armed it — that is its whole purpose — so a process that
   * stops caring about these sessions has to say so, or the timer fires into a world that has
   * moved on. In tests that meant a write landing during the next file's setup, holding a lock
   * on the audit log while it tried to truncate it; in production it is what a graceful
   * shutdown wants before the pool closes.
   */
  onModuleDestroy(): void {
    for (const timer of this.pendingFinish.values()) clearTimeout(timer);
    this.pendingFinish.clear();
  }

  private cancelFinish(noteId: string): void {
    const timer = this.pendingFinish.get(noteId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingFinish.delete(noteId);
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
      // Explicit: no grace window, and nothing left armed that could finish it twice.
      this.cancelFinish(client.session.noteId);
      this.clients.delete(socket);
      // runner.stop pushes 'stopped' to this socket itself, as a watcher, so there is no
      // second message from here that could disagree with it.
      await this.finish(client);
      socket.close();
      return;
    }

    if (message.type !== 'audio' || !message.data) return;

    /*
     * Refused while paused, before anything is transcribed.
     *
     * The browser stops recording and releases the device when it pauses, so in the ordinary
     * case nothing arrives here at all. This is for the case that is not ordinary: a segment
     * already in flight when the pause landed, or a tab running older code. Silent rather than
     * an error — the client did nothing wrong, and there is nothing for it to fix.
     */
    if (client.session.paused) return;

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
      // The same settings the behaviours run under, so the browser path and the bot path
      // are as forward as each other — they were one pipeline the moment they shared a note.
      const settings = await this.runner.behaviourSettings(actor, session.noteId);
      const { added, state } = await this.live.extract(
        session,
        note.agenda.map((a) => ({ id: a.id, title: a.title, covered: a.covered })),
        () => this.registry.newId(),
        settings.eagerness,
      );
      // Notes go into the document instead of onto the pile — the same call the runner
      // makes, so the browser microphone and the bot produce the same note.
      const suggestions = await this.runner.recordNotes(actor, session.noteId, session, added);
      if (suggestions.length > 0) {
        this.sessions.broadcast(session.noteId, { type: 'proposals', proposals: suggestions });
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

