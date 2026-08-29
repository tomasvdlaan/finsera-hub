-- Who may see a meeting note.
--
-- Until now every internal user could read every note: the permission call path checked the
-- `meetings.read` capability, which every member holds, and nothing else. That was the stated
-- v0 policy, and it stops being tenable the moment the platform holds meetings about people
-- rather than only about projects.
--
-- Two mechanisms, because there are two different questions. The ordinary one is answered by
-- the project — you see the meetings of the projects you are on — and needs no column here at
-- all, since `notes.project_id` and `crm.project_members` already say it. The other is the
-- meeting about a person, which no project can express: that gets a flag and an explicit list
-- of accounts, granted deliberately and never inferred.
ALTER TABLE "meetings"."notes" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "meetings"."note_viewers" (
	"note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" uuid NOT NULL
);--> statement-breakpoint
ALTER TABLE "meetings"."note_viewers" ADD CONSTRAINT "note_viewers_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "meetings"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_viewers_pk" ON "meetings"."note_viewers" USING btree ("note_id","user_id");--> statement-breakpoint
CREATE INDEX "note_viewers_user_idx" ON "meetings"."note_viewers" USING btree ("user_id");--> statement-breakpoint
-- The visibility filter runs on every list and every read. `notes_project_idx` is already
-- there; the author is the other half of the predicate and was not indexed.
CREATE INDEX "notes_created_by_idx" ON "meetings"."notes" USING btree ("created_by");
