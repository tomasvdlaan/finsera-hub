import { Injectable, Logger } from '@nestjs/common';
import type { CaptureSession } from './capture/provider.js';
import { LiveSession } from './live-session.js';

/** Just enough of a WebSocket to push to it, so tests need not fake the whole thing. */
export interface Watcher {
  send(payload: string): void;
  readyState: number;
  readonly OPEN?: number;
}

interface Registered {
  live: LiveSession;
  capture?: CaptureSession;
  /** Screens watching this meeting — normally one, the operator's. */
  watchers: Set<Watcher>;
}

/**
 * The live meetings currently running.
 *
 * This exists because with a bot provider the two halves of a session arrive
 * separately and in an unpredictable order: the operator's browser opens one socket to
 * watch, and Recall opens a different one to deliver audio — from the internet, seconds
 * later, with nothing but the note id to say what it belongs to. Something has to hold
 * the middle.
 *
 * In memory on purpose. A live meeting is not worth surviving a restart: the audio it
 * would need is already gone, and the transcript is written as it goes.
 */
@Injectable()
export class LiveRegistry {
  private readonly logger = new Logger(LiveRegistry.name);
  private readonly sessions = new Map<string, Registered>();

  start(noteId: string, live: LiveSession): Registered {
    const existing = this.sessions.get(noteId);
    if (existing) return existing;
    const entry: Registered = { live, watchers: new Set() };
    this.sessions.set(noteId, entry);
    this.logger.log(`Live session started for note ${noteId}`);
    return entry;
  }

  get(noteId: string): Registered | undefined {
    return this.sessions.get(noteId);
  }

  attachCapture(noteId: string, capture: CaptureSession): void {
    const entry = this.sessions.get(noteId);
    if (entry) entry.capture = capture;
  }

  watch(noteId: string, socket: Watcher): void {
    this.sessions.get(noteId)?.watchers.add(socket);
  }

  unwatch(noteId: string, socket: Watcher): void {
    this.sessions.get(noteId)?.watchers.delete(socket);
  }

  /** Push to every screen watching this meeting. */
  broadcast(noteId: string, payload: Record<string, unknown>): void {
    const entry = this.sessions.get(noteId);
    if (!entry) return;
    const message = JSON.stringify(payload);
    for (const socket of entry.watchers) {
      if (socket.readyState === (socket.OPEN ?? 1)) socket.send(message);
    }
  }

  async end(noteId: string): Promise<LiveSession | undefined> {
    const entry = this.sessions.get(noteId);
    if (!entry) return undefined;
    this.sessions.delete(noteId);
    await entry.capture?.leave().catch((error) =>
      this.logger.warn(`Could not stop capture: ${(error as Error).message}`),
    );
    return entry.live;
  }

  get active(): string[] {
    return [...this.sessions.keys()];
  }
}
