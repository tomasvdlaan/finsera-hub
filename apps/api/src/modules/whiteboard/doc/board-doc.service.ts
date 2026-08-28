import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { reconcile, type BoardElement } from '@platform/board-doc';
import type { Actor } from '@platform/contracts';

/** Long enough to collect a burst of drawing into one write, short enough to lose nothing. */
const FLUSH_AFTER_MS = 1_000;

/** A board with nobody looking at it and nothing unsaved is dropped after this. */
const IDLE_MS = 5 * 60_000;

/** How often idle boards are looked for. Well under IDLE_MS, and cheap: it walks a small map. */
const SWEEP_EVERY_MS = 60_000;

export interface Persistence {
  load(boardId: string): Promise<{ elements: BoardElement[]; appState: unknown }>;
  save(
    boardId: string,
    changed: BoardElement[],
    appState: unknown | undefined,
    actor: Actor,
  ): Promise<void>;
}

export interface BoardChange {
  boardId: string;
  /** Only what the merge accepted — never the whole scene. */
  elements: BoardElement[];
  /** So the gateway can skip nothing: everyone gets this, including whoever sent it. */
  from: string;
}

interface OpenBoard {
  elements: Map<string, BoardElement>;
  appState: Record<string, unknown>;
  /**
   * Element ids changed since the last write.
   *
   * A set rather than a flag, and that is the difference between a board that is cheap to keep
   * open and one that rewrites a megabyte every second. See whiteboard.schema.ts.
   */
  dirty: Set<string>;
  appStateDirty: boolean;
  lastActor?: Actor;
  flushTimer?: ReturnType<typeof setTimeout>;
  touchedAt: number;
  watchers: number;
}

/**
 * The authority for whiteboard scenes.
 *
 * Structurally the same idea as NoteDocService and for the same reason — several people write
 * to one thing at once, so it stops being a value people overwrite and becomes a thing people
 * send changes to — but the concurrency control is far simpler, and deliberately so.
 *
 * A note's unit of change is a ProseMirror step: an edit at an offset, which stops meaning what
 * its author meant the moment somebody else inserts text earlier in the document. That is why
 * notes need versions, a step history, rebasing, and a `behind` reply. A board's unit of change
 * is a whole element carrying its own version, so merging is last-writer-wins per element:
 * commutative, associative and idempotent. Order does not matter, a client cannot be "behind",
 * and there is nothing to rebase. The entire HISTORY / since() / behind apparatus simply is not
 * needed here, and inventing an equivalent would be building a machine to solve a problem the
 * data model already answers.
 *
 * In memory, like the note authority and LiveRegistry: this is a coordination point, not a
 * record. The record is in Postgres, written a second after the last change. **It assumes one
 * API process.** Two would each hold a divergent copy; the `WHERE excluded.version >=` guard on
 * the upsert means the DATABASE would still converge, so the failure would be "people on
 * different processes do not see each other live" rather than lost work — but it is a real
 * constraint and it is the same one the note authority carries.
 */
@Injectable()
export class BoardDocService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BoardDocService.name);
  private readonly boards = new Map<string, OpenBoard>();
  /** In-flight hydrations, so two joins arriving together cannot build two scenes. */
  private readonly opening = new Map<string, Promise<OpenBoard>>();
  private readonly listeners = new Set<(change: BoardChange) => void>();
  private persistence?: Persistence;
  private sweepTimer?: ReturnType<typeof setInterval>;

  /**
   * Actually run the idle sweep.
   *
   * Worth saying explicitly because the note authority has the same `sweep()` and nothing has
   * ever called it — so every note anybody opens stays in that process's memory until it
   * restarts. A board is orders of magnitude larger than a note body, so the same omission
   * here would be a real leak rather than a slow one.
   */
  onModuleInit(): void {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_EVERY_MS);
    this.sweepTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    // Shutting down is not a reason to lose the last second of somebody's drawing.
    await Promise.all([...this.boards.keys()].map((id) => this.flush(id).catch(() => undefined)));
  }

  bind(persistence: Persistence): void {
    this.persistence = persistence;
  }

  onChange(listener: (change: BoardChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(boardId: string): Promise<OpenBoard> {
    const existing = this.boards.get(boardId);
    if (existing) {
      existing.touchedAt = Date.now();
      return existing;
    }

    const pending = this.opening.get(boardId);
    if (pending) return pending;

    const hydrate = this.hydrate(boardId).finally(() => this.opening.delete(boardId));
    this.opening.set(boardId, hydrate);
    return hydrate;
  }

  private async hydrate(boardId: string): Promise<OpenBoard> {
    const stored = await this.persistence!.load(boardId);
    // A second join may have won the race while this awaited.
    const raced = this.boards.get(boardId);
    if (raced) return raced;

    const entry: OpenBoard = {
      elements: new Map(stored.elements.map((el) => [el.id, el])),
      appState: (stored.appState as Record<string, unknown>) ?? {},
      dirty: new Set(),
      appStateDirty: false,
      touchedAt: Date.now(),
      watchers: 0,
    };
    this.boards.set(boardId, entry);
    return entry;
  }

  /**
   * The whole scene, tombstones included.
   *
   * The tombstones are the point. A client that deleted something while its socket was down and
   * is then handed a scene simply omitting the element cannot tell "deleted" from "never heard
   * of it" — so it keeps its own copy and the deletion quietly undoes itself.
   */
  async snapshot(boardId: string): Promise<{ elements: BoardElement[]; appState: unknown }> {
    const entry = await this.open(boardId);
    return { elements: [...entry.elements.values()], appState: entry.appState };
  }

  /**
   * Merge what a client drew.
   *
   * Returns only what was accepted. A stale or malformed element is dropped individually rather
   * than failing the batch: one bad shape must not cost a room its edits.
   */
  async apply(
    boardId: string,
    input: { elements: readonly unknown[]; actor: Actor; from: string },
  ): Promise<BoardElement[]> {
    const entry = await this.open(boardId);
    const accepted = reconcile(entry.elements, input.elements);
    if (accepted.length === 0) return [];

    for (const el of accepted) entry.dirty.add(el.id);
    entry.lastActor = input.actor;
    entry.touchedAt = Date.now();
    this.scheduleFlush(boardId, entry);

    const change: BoardChange = { boardId, elements: accepted, from: input.from };
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        this.logger.warn(`A board change listener threw: ${(error as Error).message}`);
      }
    }
    return accepted;
  }

  /** Background colour and grid. Scene state, unlike a viewport, which belongs to a person. */
  async setAppState(
    boardId: string,
    appState: Record<string, unknown>,
    actor: Actor,
  ): Promise<void> {
    const entry = await this.open(boardId);
    entry.appState = { ...entry.appState, ...appState };
    entry.appStateDirty = true;
    entry.lastActor = actor;
    entry.touchedAt = Date.now();
    this.scheduleFlush(boardId, entry);
  }

  /** Somebody has the board open; hold it even while they are not drawing. */
  watch(boardId: string): void {
    const entry = this.boards.get(boardId);
    if (entry) entry.watchers += 1;
  }

  unwatch(boardId: string): void {
    const entry = this.boards.get(boardId);
    if (entry && entry.watchers > 0) entry.watchers -= 1;
  }

  /** Write out now — before anything that reads the board from the database. */
  async flush(boardId: string): Promise<void> {
    const entry = this.boards.get(boardId);
    if (!entry) return;
    if (entry.dirty.size === 0 && !entry.appStateDirty) return;

    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = undefined;

    /*
     * Snapshot and clear BEFORE awaiting.
     *
     * Anything drawn while the write is in flight has to land in the next flush, not be
     * swallowed by this one clearing the set after the fact.
     */
    const ids = [...entry.dirty];
    entry.dirty.clear();
    const hadAppState = entry.appStateDirty;
    entry.appStateDirty = false;

    const actor = entry.lastActor;
    if (!actor) return;

    const changed = ids
      .map((id) => entry.elements.get(id))
      .filter((el): el is BoardElement => el !== undefined);

    try {
      await this.persistence!.save(
        boardId,
        changed,
        hadAppState ? entry.appState : undefined,
        actor,
      );
    } catch (error) {
      /*
       * Put them back, so the next change or the next flush retries rather than dropping the
       * work. A union rather than an assignment: ids that went dirty while this write was in
       * flight are already in the set and must not be overwritten by the old list.
       */
      for (const id of ids) entry.dirty.add(id);
      if (hadAppState) entry.appStateDirty = true;
      this.logger.error(`Could not save board ${boardId}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Let a board go.
   *
   * Flushes first. Anything still holding it simply reopens, so this is never destructive.
   */
  async release(boardId: string): Promise<void> {
    await this.flush(boardId).catch(() => undefined);
    const entry = this.boards.get(boardId);
    if (entry?.flushTimer) clearTimeout(entry.flushTimer);
    this.boards.delete(boardId);
  }

  /** Boards nobody is holding, nothing is unsaved in, and nothing has touched. */
  sweep(now = Date.now()): void {
    for (const [boardId, entry] of this.boards) {
      if (entry.watchers > 0 || entry.dirty.size > 0 || entry.appStateDirty) continue;
      if (now - entry.touchedAt < IDLE_MS) continue;
      if (entry.flushTimer) clearTimeout(entry.flushTimer);
      this.boards.delete(boardId);
    }
  }

  private scheduleFlush(boardId: string, entry: OpenBoard): void {
    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = setTimeout(() => {
      void this.flush(boardId).catch(() => undefined);
    }, FLUSH_AFTER_MS);
    // Node keeps the process alive for a pending timer; a board nobody is drawing on should
    // not be the reason a container refuses to shut down.
    entry.flushTimer.unref?.();
  }
}
