CREATE TABLE "meetings"."transcripts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"provider" text DEFAULT 'browser' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings"."transcripts" ADD CONSTRAINT "transcripts_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "meetings"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcripts_note_idx" ON "meetings"."transcripts" USING btree ("note_id");