import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Whiteboards.
 *
 * A board is a canvas people draw on together — usually over a pasted screenshot, usually
 * while talking. It is a record like any other: registered, audited, permissioned, backed up.
 * The drawing itself belongs to Excalidraw, whose element shape this schema deliberately does
 * not mirror; see `elements.payload`.
 *
 * Named `whiteboard` rather than `board` because SCRUM already owns "Board" at /board, and a
 * second thing by that name in the same nav section would be a coin flip every time.
 */
export const whiteboard = pgSchema('whiteboard');

export const boards = whiteboard.table(
  'boards',
  {
    id: uuid('id').primaryKey(), // registry id, app-minted uuidv7

    title: text('title').notNull(),

    /**
     * The meeting this was drawn in, if any.
     *
     * A registry id, not a foreign key — the same cross-module rule as everywhere else, so
     * whiteboard and meetings never become a cycle.
     */
    meetingId: uuid('meeting_id'),

    /**
     * Scene-level state: background colour, grid.
     *
     * Never a viewport. Where somebody has scrolled and how far they have zoomed is theirs,
     * and persisting it would mean opening a board and being yanked to wherever the last
     * person happened to be looking.
     */
    appState: jsonb('app_state').notNull().default(sql`'{}'::jsonb`),

    /**
     * When an element last changed, as opposed to when the row was last touched.
     *
     * The library sorts on this. `updated_at` moves when somebody renames the board, which is
     * not the same as somebody drawing on it.
     */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),

    /** A rendered PNG in storage, regenerated when the board goes idle. Null until drawn on. */
    thumbnailKey: text('thumbnail_key'),

    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Archive, never delete — the same as everywhere else. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('boards_meeting_idx').on(t.meetingId),
    index('boards_activity_idx').on(t.lastActivityAt),
  ],
);

/**
 * One Excalidraw element.
 *
 * **One row per element rather than one jsonb scene per board**, and that is the load-bearing
 * decision in this module. The live scene is held in memory and flushed on a one-second
 * debounce. A busy board is a couple of thousand elements — a megabyte or two of JSON — so a
 * scene blob would mean rewriting a megabyte of TOASTed jsonb once a second while somebody
 * drags a sticky note. Postgres updates are copy-on-write: each of those writes a new row
 * version and new TOAST chunks and dead-tuples the old ones. An hour of a meeting is thousands
 * of megabyte rewrites for a workload whose actual content was "one element moved 40 pixels",
 * with autovacuum chasing a single hot row the whole time.
 *
 * Rows make the write proportional to the change. The authority already tracks which elements
 * changed, because it has to know what to broadcast; flushing that same set is one multi-row
 * upsert. One drag, one row.
 *
 * `element_id` is Excalidraw's own id — a nanoid minted in the browser, NOT a registry id and
 * NOT a uuid. It is the identity every peer already agrees about and the one the merge compares
 * on, so it is the key. A surrogate id would be a second thing to keep in step for nobody's
 * benefit.
 *
 * `version`, `version_nonce` and `updated` are Excalidraw's own conflict-resolution fields,
 * promoted out of the payload into columns because the merge reads them on every message.
 * Everything else stays in `payload` verbatim: that shape belongs to Excalidraw and changes
 * when they release, and a schema mirroring it would be a migration every time.
 */
export const elements = whiteboard.table(
  'elements',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),

    version: integer('version').notNull(),
    versionNonce: bigint('version_nonce', { mode: 'number' }).notNull(),
    /** Excalidraw's own epoch-ms stamp. Carried for their sake, never used to decide a winner. */
    updated: bigint('updated', { mode: 'number' }).notNull(),

    /**
     * Excalidraw's soft delete.
     *
     * A tombstone has to persist. Drop it and the next client to join is told the element does
     * not exist, which is indistinguishable from never having heard of it — so it keeps its own
     * copy and the deletion undoes itself.
     */
    isDeleted: boolean('is_deleted').notNull().default(false),

    /** 'rectangle' | 'text' | 'image' | … — a column so reading a board's text need not scan jsonb. */
    type: text('type').notNull(),

    /** The whole element, verbatim, including the fields above. Excalidraw's shape, not ours. */
    payload: jsonb('payload').notNull(),

    /** Whoever's flush last wrote this row. Attribution, not authorship of every stroke. */
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.elementId] }),
    // The load query: the live elements of one board.
    index('elements_board_live_idx').on(t.boardId, t.isDeleted),
  ],
);

/**
 * An image pasted onto a board.
 *
 * `file_id` is Excalidraw's content hash, which it mints and which the image ELEMENT
 * references. Two people pasting the same screenshot produce the same file_id, so the key is
 * (board_id, file_id) and a re-paste is an upsert rather than a second megabyte.
 *
 * Deliberately NOT a Document, for exactly the reason a note's images are not: a screenshot
 * somebody drew over is part of the board, and filing every one of them would bury the
 * contracts and invoices that belong in Documents.
 */
export const boardFiles = whiteboard.table(
  'board_files',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    fileId: text('file_id').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.fileId] })],
);
