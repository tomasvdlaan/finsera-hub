import { Injectable, Logger } from '@nestjs/common';
import {
  Node as ProsemirrorNode,
  Step,
  Transform,
  docToMarkdown,
  markdownToDoc,
  noteSchema,
} from '@platform/note-doc';
import type { Actor } from '@platform/contracts';

/**
 * How many steps are kept so a client that fell behind can catch up.
 *
 * Beyond this it is told to reload, which costs it nothing but a fetch — the document is
 * small and the alternative is holding every keystroke of a two-hour meeting in memory
 * forever. About twenty minutes of continuous typing.
 */
const HISTORY = 2_000;

/** Long enough to collect a burst of typing into one write, short enough to lose nothing. */
const FLUSH_AFTER_MS = 1_000;

/** A document with nobody looking at it and nothing unsaved is dropped after this. */
const IDLE_MS = 5 * 60_000;

export interface Persistence {
  /** The stored Markdown body. */
  load(noteId: string): Promise<string>;
  /** Write the body back, attributed to whoever last changed it. */
  save(noteId: string, markdown: string, actor: Actor): Promise<void>;
}

export interface Change {
  noteId: string;
  version: number;
  steps: Step[];
  /** Who authored each step, aligned with `steps`, so a client can skip its own. */
  clientIds: string[];
}

interface OpenDoc {
  doc: ProsemirrorNode;
  /** Total steps ever applied. This is what a client's `version` is compared against. */
  version: number;
  /** Recent steps, most recent last. `steps[0]` is at version `version - steps.length`. */
  steps: Step[];
  clientIds: string[];
  dirty: boolean;
  /** Attribution for the next flush — the last person or agent whose step landed. */
  lastActor?: Actor;
  flushTimer?: ReturnType<typeof setTimeout>;
  touchedAt: number;
  watchers: number;
}

export type ApplyResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'behind' | 'invalid' };

/**
 * The authority for note bodies.
 *
 * Every writer used to read the whole body, change the string, and write the whole body back.
 * Four of them could do that at once — the editor's autosave, the note-taking behaviour every
 * ninety seconds, the assembly that runs when a recording stops, and the assistant's
 * `meetings_write_note`, which fires from the chat panel or from a wake word mid-meeting. Last
 * write won and the others vanished, with nothing anywhere reporting it. That was reachable
 * with one person in the room; with two it would be constant.
 *
 * So the body stops being a string that people overwrite and becomes a document that people
 * send changes to. A change is a ProseMirror step: a bounded description of what happened at
 * which positions. Two steps that touch different parts of the note both survive, and two that
 * touch the same part are rebased in a defined order rather than one silently winning.
 *
 * **The stored form is still Markdown.** `notes.body` is unchanged, which is why the full-text
 * index, the embedding pipeline, `v_notes`, the templates and the portal needed no migration
 * at all. This holds the document only while somebody has it open, hydrating from Markdown on
 * the first join and flushing back a second after the last change. Durability is therefore no
 * worse than the autosave it replaces, and a restart loses at most a second of typing.
 *
 * In memory, like LiveRegistry and for the same reason: it is a coordination point, not a
 * record. The record is in Postgres.
 */
@Injectable()
export class NoteDocService {
  private readonly logger = new Logger(NoteDocService.name);
  private readonly docs = new Map<string, OpenDoc>();
  /** In-flight hydrations, so two joins arriving together cannot build two documents. */
  private readonly opening = new Map<string, Promise<OpenDoc>>();
  private readonly listeners = new Set<(change: Change) => void>();
  private persistence?: Persistence;

  /**
   * Where bodies are read and written.
   *
   * Injected rather than depended on, because the thing that persists a note is
   * MeetingsService and MeetingsService needs this — asking Nest to resolve that circle with
   * forwardRef would work and would also make both harder to test. This module already binds
   * its AI tools the same way.
   */
  bind(persistence: Persistence): void {
    this.persistence = persistence;
  }

  onChange(listener: (change: Change) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The document as it stands, opening it if nobody had it. */
  async open(noteId: string): Promise<OpenDoc> {
    const existing = this.docs.get(noteId);
    if (existing) {
      existing.touchedAt = Date.now();
      return existing;
    }

    const pending = this.opening.get(noteId);
    if (pending) return pending;

    const hydrate = this.hydrate(noteId).finally(() => this.opening.delete(noteId));
    this.opening.set(noteId, hydrate);
    return hydrate;
  }

  private async hydrate(noteId: string): Promise<OpenDoc> {
    const markdown = await this.persistence!.load(noteId);
    // A second join may have won the race while this awaited.
    const raced = this.docs.get(noteId);
    if (raced) return raced;

    const entry: OpenDoc = {
      doc: markdownToDoc(markdown),
      version: 0,
      steps: [],
      clientIds: [],
      dirty: false,
      touchedAt: Date.now(),
      watchers: 0,
    };
    this.docs.set(noteId, entry);
    return entry;
  }

  /** What a client needs to start editing: the document and the version it is at. */
  async snapshot(noteId: string): Promise<{ version: number; doc: unknown; markdown: string }> {
    const entry = await this.open(noteId);
    return {
      version: entry.version,
      doc: entry.doc.toJSON(),
      markdown: docToMarkdown(entry.doc),
    };
  }

  /**
   * Apply a client's steps.
   *
   * Refuses anything not based on the current version. That refusal is the whole concurrency
   * control: the client pulls what it missed with `since`, rebases its own work on top and
   * sends again, which is what prosemirror-collab does for it. Accepting a stale batch would
   * apply changes at positions that no longer mean what the client thought they meant.
   */
  async apply(
    noteId: string,
    input: { version: number; steps: unknown[]; clientId: string; actor: Actor },
  ): Promise<ApplyResult> {
    const entry = await this.open(noteId);
    if (input.version !== entry.version) return { ok: false, reason: 'behind' };

    const steps: Step[] = [];
    let doc = entry.doc;
    for (const raw of input.steps) {
      try {
        const step = Step.fromJSON(noteSchema, raw);
        const applied = step.apply(doc);
        // A step can fail to apply even at the right version — a deletion inside a range
        // another step already removed. Rejecting the batch is right: half of it is not a
        // document anybody described.
        if (!applied.doc) return { ok: false, reason: 'invalid' };
        doc = applied.doc;
        steps.push(step);
      } catch {
        /*
         * Both `fromJSON` and `apply` throw rather than return for a position outside the
         * document, so the catch has to cover both. Anything arriving over a socket is
         * untrusted input, and a RangeError escaping here would take down the connection
         * for every other person in the meeting rather than just refusing one bad batch.
         */
        return { ok: false, reason: 'invalid' };
      }
    }

    /*
     * The result has to be a document the schema actually allows.
     *
     * `step.apply` is more forgiving than it looks: a hand-made step can produce a tree it
     * accepts and every browser then refuses, because ProseMirror validates content on the
     * way in to a Transform. The consequence is not one bad edit — the step is in the
     * history, so every client that pulls it throws, and the note becomes uneditable for
     * everybody until somebody notices and resets the body by hand. That is a bad enough
     * outcome to be worth one validation on a path that is otherwise cheap.
     */
    try {
      doc.check();
    } catch {
      return { ok: false, reason: 'invalid' };
    }

    this.commit(noteId, entry, doc, steps, steps.map(() => input.clientId), input.actor);
    return { ok: true, version: entry.version };
  }

  /**
   * Change the document from the server — the assistant's path.
   *
   * The caller gets a `Transform` over the current document and describes its edit on it;
   * whatever steps that produces are applied and broadcast exactly like a person's. This is
   * the point of the whole design: an AI edit is not a rewrite that races the editor, it is a
   * participant's change, rebased against live typing by the same machinery.
   *
   * Attributed to `actor`, so a note the assistant wrote is traceable to the assistant.
   */
  async edit(
    noteId: string,
    actor: Actor,
    mutate: (tr: Transform, doc: ProsemirrorNode) => void,
  ): Promise<{ version: number; markdown: string }> {
    const entry = await this.open(noteId);
    const tr = new Transform(entry.doc);
    mutate(tr, entry.doc);

    if (tr.steps.length > 0) {
      this.commit(noteId, entry, tr.doc, tr.steps, tr.steps.map(() => 'server'), actor);
    }
    return { version: entry.version, markdown: docToMarkdown(entry.doc) };
  }

  /**
   * Replace the whole document, because something set the body wholesale.
   *
   * The blunt instrument, and the only one that should ever produce a change covering the
   * entire note. It exists for the callers that genuinely mean it — a body written directly
   * through `MeetingsService.update` — so that what they wrote reaches the people who have
   * the note open, instead of being quietly reverted by the next flush.
   *
   * Does nothing if nobody has the document: the table is the record, and the next person to
   * open it will read exactly this.
   */
  async replace(noteId: string, actor: Actor, markdown: string): Promise<void> {
    const entry = this.docs.get(noteId);
    if (!entry) return;

    const next = markdownToDoc(markdown);
    if (next.eq(entry.doc)) return;

    const tr = new Transform(entry.doc);
    tr.replaceWith(0, tr.doc.content.size, next.content);
    if (tr.steps.length === 0) return;

    this.commit(noteId, entry, tr.doc, tr.steps, tr.steps.map(() => 'server'), actor);
    // Already in the table — that is where it came from.
    entry.dirty = false;
  }

  /** Steps a client has not seen, or `null` if it is too far behind to catch up. */
  async since(noteId: string, version: number): Promise<Change | null> {
    const entry = await this.open(noteId);
    const oldest = entry.version - entry.steps.length;
    if (version < oldest || version > entry.version) return null;

    const from = version - oldest;
    return {
      noteId,
      version: entry.version,
      steps: entry.steps.slice(from),
      clientIds: entry.clientIds.slice(from),
    };
  }

  /** The current body as Markdown, without opening the document if nobody has it. */
  async markdown(noteId: string): Promise<string> {
    const entry = this.docs.get(noteId);
    return entry ? docToMarkdown(entry.doc) : this.persistence!.load(noteId);
  }

  /** Somebody opened the note; hold it even while they are not typing. */
  watch(noteId: string): void {
    const entry = this.docs.get(noteId);
    if (entry) entry.watchers += 1;
  }

  unwatch(noteId: string): void {
    const entry = this.docs.get(noteId);
    if (entry && entry.watchers > 0) entry.watchers -= 1;
  }

  /** Write the body out now — before anything that reads the note from the database. */
  async flush(noteId: string): Promise<void> {
    const entry = this.docs.get(noteId);
    if (!entry?.dirty) return;
    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = undefined;

    const markdown = docToMarkdown(entry.doc);
    const actor = entry.lastActor;
    entry.dirty = false;
    try {
      if (actor) await this.persistence!.save(noteId, markdown, actor);
    } catch (error) {
      // Put it back, so the next change or the next flush tries again rather than dropping
      // the work on the floor.
      entry.dirty = true;
      this.logger.error(`Could not save note ${noteId}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Let a note go.
   *
   * Flushes first. Called when a meeting stops and by the idle sweep; anything still holding
   * the note simply reopens it, so this is never destructive.
   */
  async release(noteId: string): Promise<void> {
    await this.flush(noteId).catch(() => undefined);
    const entry = this.docs.get(noteId);
    if (entry?.flushTimer) clearTimeout(entry.flushTimer);
    this.docs.delete(noteId);
  }

  /** Documents nobody is holding, nothing is unsaved in, and nothing has touched. */
  async sweep(now = Date.now()): Promise<void> {
    for (const [noteId, entry] of this.docs) {
      if (entry.watchers > 0 || entry.dirty) continue;
      if (now - entry.touchedAt < IDLE_MS) continue;
      this.docs.delete(noteId);
    }
  }

  private commit(
    noteId: string,
    entry: OpenDoc,
    doc: ProsemirrorNode,
    steps: Step[],
    clientIds: string[],
    actor: Actor,
  ): void {
    entry.doc = doc;
    entry.version += steps.length;
    entry.steps.push(...steps);
    entry.clientIds.push(...clientIds);
    entry.dirty = true;
    entry.lastActor = actor;
    entry.touchedAt = Date.now();

    if (entry.steps.length > HISTORY) {
      const drop = entry.steps.length - HISTORY;
      entry.steps.splice(0, drop);
      entry.clientIds.splice(0, drop);
    }

    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = setTimeout(() => {
      void this.flush(noteId).catch(() => undefined);
    }, FLUSH_AFTER_MS);
    // Node keeps the process alive for a pending timer; a note nobody is editing should not
    // be the reason a container refuses to shut down.
    entry.flushTimer.unref?.();

    const change: Change = { noteId, version: entry.version, steps, clientIds };
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        this.logger.warn(`A change listener threw: ${(error as Error).message}`);
      }
    }
  }
}
