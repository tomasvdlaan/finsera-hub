CREATE TABLE "scrum"."task_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"moved_by" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scrum"."tasks" ADD COLUMN "type" text DEFAULT 'story' NOT NULL;--> statement-breakpoint
ALTER TABLE "scrum"."task_transitions" ADD CONSTRAINT "task_transitions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "scrum"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_transitions_task_idx" ON "scrum"."task_transitions" USING btree ("task_id","at");