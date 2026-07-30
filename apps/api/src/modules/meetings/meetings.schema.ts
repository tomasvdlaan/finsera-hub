import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** pgvector column. Declared here for the same reason docs declares it — see below. */
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value: number[]) => `[${value.join(',')}]`,
    fromDriver: (value: string) => JSON.parse(value) as number[],
  })(name);

/**
 * Vector width, declared literally rather than imported.
 *
 * The migration tool loads schema files in isolation, so a schema cannot import across
 * the tree. The value must match core's EMBEDDING_DIMENSIONS, and a test asserts that so
 * the two cannot drift apart silently.
 */
const EMBEDDING_DIMENSIONS = 768;

/**
 * Meeting Notes (Phase 6b).
 *
 * A note is not a file. It lives here rather than in Document Management because it is
 * written and rewritten rather than uploaded, and because the things hanging off it —
 * an agenda, attendees, action points — are structure a file does not have.
 *
 * The body is MARKDOWN, not editor JSON. It stays greppable and diffable, it is what the
 * knowledge layer indexes, and it is what a model can both read and write — which matters
 * because Phase 6c will generate note content live. A WYSIWYG layer can sit on top of
 * Markdown later; the reverse is much harder.
 */
export const meetings = pgSchema('meetings');

export const NOTE_STATUSES = ['draft', 'final'] as const;
export const ACTION_STATUSES = ['proposed', 'accepted', 'dismissed'] as const;
/** Null until asked. 6c refuses to process audio unless every attendee has granted. */
export const CONSENT_STATES = ['granted', 'declined'] as const;

export const notes = meetings.table(
  'notes',
  {
    id: uuid('id').primaryKey(), // registry id

    title: text('title').notNull(),
    /** Registry ids, not FKs — the same cross-module rule as everywhere else. */
    clientId: uuid('client_id'),
    projectId: uuid('project_id'),

    meetingDate: date('meeting_date').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    /** Markdown. See the note on the schema above. */
    body: text('body').notNull().default(''),
    /** Which template this started from, kept for reporting on how meetings are run. */
    template: text('template'),

    status: text('status').notNull().default('draft'),

    /**
     * Totals across every recording of this meeting — when it was last transcribed, and
     * what all of it has cost. The per-recording detail lives in `transcripts`; these are
     * the running sums, so recording a second time adds rather than replaces.
     *
     * Audio itself is never stored, only what was said and what it cost.
     */
    transcribedAt: timestamp('transcribed_at', { withTimezone: true }),
    transcriptTokens: integer('transcript_tokens'),
    transcriptCostCents: integer('transcript_cost_cents'),

    createdBy: uuid('created_by').notNull(),
    finalisedAt: timestamp('finalised_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notes_client_idx').on(t.clientId),
    index('notes_project_idx').on(t.projectId),
    index('notes_date_idx').on(t.meetingDate),
    check('notes_status_valid', sql`${t.status} IN ('draft','final')`),
    check(
      'notes_finalised_is_complete',
      sql`(${t.finalisedAt} IS NULL) = (${t.status} <> 'final')`,
    ),
    check('notes_ends_after_start', sql`${t.endedAt} IS NULL OR ${t.startedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
  ],
);

/**
 * The agenda.
 *
 * Structure rather than a Markdown list, because 6c needs to say "we have not covered
 * item 3" — which requires items to be things, not text.
 */
export const agendaItems = meetings.table(
  'agenda_items',
  {
    id: uuid('id').primaryKey(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    /** Marked by you, or proposed by 6c and confirmed. Never set automatically. */
    covered: boolean('covered').notNull().default(false),
    coveredAt: timestamp('covered_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [
    index('agenda_note_idx').on(t.noteId),
    uniqueIndex('agenda_position').on(t.noteId, t.position),
  ],
);

/**
 * Who was there.
 *
 * `consent` exists for 6c and is deliberately here rather than in the recording session:
 * consent is about a person in a meeting, and it should be answerable before anyone
 * decides whether to record.
 */
export const attendees = meetings.table(
  'attendees',
  {
    id: uuid('id').primaryKey(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    /** Registry id of a CRM contact or a platform user, when the person is known. */
    contactId: uuid('contact_id'),
    userId: uuid('user_id'),
    consent: text('consent'),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    /**
     * Set when the meeting bot actually saw this person in the call.
     *
     * Distinguishes who was expected from who turned up — and the gap between the two is
     * the interesting part: somebody in the room who was never asked for consent.
     */
    detectedAt: timestamp('detected_at', { withTimezone: true }),
  },
  (t) => [
    index('attendees_note_idx').on(t.noteId),
    check(
      'attendees_consent_valid',
      sql`${t.consent} IS NULL OR ${t.consent} IN ('granted','declined')`,
    ),
    check('attendees_consent_has_time', sql`${t.consent} IS NULL OR ${t.consentAt} IS NOT NULL`),
  ],
);

/**
 * Action points.
 *
 * They start as PROPOSED — whether typed by you or extracted by a model — and become a
 * SCRUM task only when accepted. Nothing reaches the board without a decision, which is
 * the same position taken everywhere the AI touches a real record.
 */
export const actionItems = meetings.table(
  'action_items',
  {
    id: uuid('id').primaryKey(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    assigneeId: uuid('assignee_id'),
    dueOn: date('due_on'),
    status: text('status').notNull().default('proposed'),
    /** The registry id of the SCRUM task this became, once accepted. */
    taskId: uuid('task_id'),
    /** 'typed' or 'ai' — so it is always visible where a suggestion came from. */
    source: text('source').notNull().default('typed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('action_items_note_idx').on(t.noteId),
    check('action_items_status_valid', sql`${t.status} IN ('proposed','accepted','dismissed')`),
    check('action_items_source_valid', sql`${t.source} IN ('typed','ai')`),
    // Accepted means it became a task; the two cannot drift apart.
    check(
      'action_items_accepted_has_task',
      sql`${t.status} <> 'accepted' OR ${t.taskId} IS NOT NULL`,
    ),
  ],
);

/**
 * What was said, one row per recording.
 *
 * Kept out of `notes.body`, where it used to be appended. The body is indexed for search
 * and read by the assistant, and a transcript is thousands of words of speech — half-
 * sentences, filler, repetition — that swamped the note it was attached to. A search for
 * a decision returned the ten seconds around the moment someone nearly said it.
 *
 * One row per recording, not per note: a note recorded twice has two of these, each with
 * its own start time and cost, and neither replaces the other.
 *
 * `lines` is jsonb rather than a row per line because a transcript is written once and
 * read whole. A thousand rows per meeting would buy a query nothing here asks.
 */
export const transcripts = meetings.table(
  'transcripts',
  {
    id: uuid('id').primaryKey(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    /** When the recording began, which is what distinguishes one from another. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    /** 'recall' for a bot, 'browser' for the microphone or a tab. */
    provider: text('provider').notNull().default('browser'),
    /** TranscriptLine[] — id, at, text, and speaker where the provider knew one. */
    lines: jsonb('lines').notNull().default(sql`'[]'::jsonb`),
    tokens: integer('tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transcripts_note_idx').on(t.noteId)],
);

/** Note chunks for semantic search — the same shape docs uses, over its own rows. */
export const noteChunks = meetings.table(
  'note_chunks',
  {
    id: uuid('id').primaryKey(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', EMBEDDING_DIMENSIONS),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('note_chunks_note_idx').on(t.noteId)],
);
