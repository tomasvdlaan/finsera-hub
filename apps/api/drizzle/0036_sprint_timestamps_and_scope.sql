CREATE TABLE "scrum"."sprint_scope_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sprint_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"change" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_by" uuid NOT NULL,
	CONSTRAINT "sprint_scope_change_valid" CHECK ("scrum"."sprint_scope_changes"."change" IN ('added','removed'))
);
--> statement-breakpoint
ALTER TABLE "scrum"."sprints" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scrum"."sprints" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scrum"."sprint_scope_changes" ADD CONSTRAINT "sprint_scope_changes_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "scrum"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_scope_changes_sprint_idx" ON "scrum"."sprint_scope_changes" USING btree ("sprint_id","at");