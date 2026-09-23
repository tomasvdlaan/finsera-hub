CREATE TABLE "meetings"."proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"confidence" double precision,
	"triage_score" double precision,
	"eagerness" text,
	"queued_ahead" integer DEFAULT 0 NOT NULL,
	"window" text,
	"outcome" text DEFAULT 'open' NOT NULL,
	"dismiss_reason" text,
	"decided_by" uuid,
	"shown_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_outcome_valid" CHECK ("meetings"."proposals"."outcome" IN ('open','kept','dismissed')),
	CONSTRAINT "proposals_dismiss_reason_valid" CHECK ("meetings"."proposals"."dismiss_reason" IS NULL OR "meetings"."proposals"."dismiss_reason" IN ('judged','reflex','duplicate')),
	CONSTRAINT "proposals_reason_needs_dismissal" CHECK ("meetings"."proposals"."dismiss_reason" IS NULL OR "meetings"."proposals"."outcome" = 'dismissed')
);
--> statement-breakpoint
ALTER TABLE "meetings"."action_items" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "meetings"."proposals" ADD CONSTRAINT "proposals_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "meetings"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_note_idx" ON "meetings"."proposals" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "proposals_outcome_kind_idx" ON "meetings"."proposals" USING btree ("outcome","kind");--> statement-breakpoint
CREATE INDEX "proposals_source_idx" ON "meetings"."proposals" USING btree ("source");--> statement-breakpoint
CREATE INDEX "action_items_proposal_idx" ON "meetings"."action_items" USING btree ("proposal_id");