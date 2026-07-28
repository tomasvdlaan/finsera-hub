CREATE SCHEMA "meetings";
--> statement-breakpoint
CREATE TABLE "meetings"."action_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"text" text NOT NULL,
	"assignee_id" uuid,
	"due_on" date,
	"status" text DEFAULT 'proposed' NOT NULL,
	"task_id" uuid,
	"source" text DEFAULT 'typed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_items_status_valid" CHECK ("meetings"."action_items"."status" IN ('proposed','accepted','dismissed')),
	CONSTRAINT "action_items_source_valid" CHECK ("meetings"."action_items"."source" IN ('typed','ai')),
	CONSTRAINT "action_items_accepted_has_task" CHECK ("meetings"."action_items"."status" <> 'accepted' OR "meetings"."action_items"."task_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "meetings"."agenda_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"covered" boolean DEFAULT false NOT NULL,
	"covered_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "meetings"."attendees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"contact_id" uuid,
	"user_id" uuid,
	"consent" text,
	"consent_at" timestamp with time zone,
	CONSTRAINT "attendees_consent_valid" CHECK ("meetings"."attendees"."consent" IS NULL OR "meetings"."attendees"."consent" IN ('granted','declined')),
	CONSTRAINT "attendees_consent_has_time" CHECK ("meetings"."attendees"."consent" IS NULL OR "meetings"."attendees"."consent_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "meetings"."note_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings"."notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"meeting_date" date NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"body" text DEFAULT '' NOT NULL,
	"template" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"transcribed_at" timestamp with time zone,
	"transcript_tokens" integer,
	"transcript_cost_cents" integer,
	"created_by" uuid NOT NULL,
	"finalised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_status_valid" CHECK ("meetings"."notes"."status" IN ('draft','final')),
	CONSTRAINT "notes_finalised_is_complete" CHECK (("meetings"."notes"."finalised_at" IS NULL) = ("meetings"."notes"."status" <> 'final')),
	CONSTRAINT "notes_ends_after_start" CHECK ("meetings"."notes"."ended_at" IS NULL OR "meetings"."notes"."started_at" IS NULL OR "meetings"."notes"."ended_at" >= "meetings"."notes"."started_at")
);
--> statement-breakpoint
ALTER TABLE "meetings"."action_items" ADD CONSTRAINT "action_items_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "meetings"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."agenda_items" ADD CONSTRAINT "agenda_items_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "meetings"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."attendees" ADD CONSTRAINT "attendees_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "meetings"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."note_chunks" ADD CONSTRAINT "note_chunks_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "meetings"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_items_note_idx" ON "meetings"."action_items" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "agenda_note_idx" ON "meetings"."agenda_items" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_position" ON "meetings"."agenda_items" USING btree ("note_id","position");--> statement-breakpoint
CREATE INDEX "attendees_note_idx" ON "meetings"."attendees" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "note_chunks_note_idx" ON "meetings"."note_chunks" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "notes_client_idx" ON "meetings"."notes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "notes_project_idx" ON "meetings"."notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notes_date_idx" ON "meetings"."notes" USING btree ("meeting_date");