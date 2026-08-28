-- Whiteboards.
--
-- One row per ELEMENT rather than one jsonb scene per board. The live scene is held in memory
-- and flushed on a one-second debounce, so a scene blob would mean rewriting a megabyte of
-- TOASTed jsonb once a second while somebody drags a sticky note -- copy-on-write, new TOAST
-- chunks, dead tuples, and autovacuum chasing a single hot row for the length of a meeting.
-- Per-element rows make the write proportional to the change: one drag, one row.
--
-- version / version_nonce / updated are Excalidraw's own conflict-resolution fields, promoted
-- out of the payload into columns because the merge reads them on every message. The rest of
-- the element stays in `payload` verbatim: that shape belongs to Excalidraw and changes when
-- they release, and a schema mirroring it would be a migration every time.
CREATE SCHEMA IF NOT EXISTS "whiteboard";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whiteboard"."boards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"meeting_id" uuid,
	"app_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_activity_at" timestamp with time zone,
	"thumbnail_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whiteboard"."elements" (
	"board_id" uuid NOT NULL,
	"element_id" text NOT NULL,
	"version" integer NOT NULL,
	"version_nonce" bigint NOT NULL,
	"updated" bigint NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "elements_board_id_element_id_pk" PRIMARY KEY("board_id","element_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whiteboard"."board_files" (
	"board_id" uuid NOT NULL,
	"file_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_files_board_id_file_id_pk" PRIMARY KEY("board_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "whiteboard"."elements" ADD CONSTRAINT "elements_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "whiteboard"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard"."board_files" ADD CONSTRAINT "board_files_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "whiteboard"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boards_meeting_idx" ON "whiteboard"."boards" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "boards_activity_idx" ON "whiteboard"."boards" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "elements_board_live_idx" ON "whiteboard"."elements" USING btree ("board_id","is_deleted");--> statement-breakpoint
-- Elements are rewritten in place far more often than they are inserted. A lower fillfactor
-- leaves room on the page for HOT updates, so the index above is not rebuilt on every drag.
ALTER TABLE "whiteboard"."elements" SET (fillfactor = 70);
