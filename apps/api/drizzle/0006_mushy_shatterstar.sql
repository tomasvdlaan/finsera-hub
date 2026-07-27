CREATE SCHEMA "scrum";
--> statement-breakpoint
CREATE TABLE "scrum"."boards" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"columns" jsonb DEFAULT '[{"key":"to_do","label":"To do","isDone":false},{"key":"in_progress","label":"In progress","isDone":false},{"key":"waiting_on_client","label":"Waiting on client","isDone":false},{"key":"review","label":"Review","isDone":false},{"key":"done","label":"Done","isDone":true}]'::jsonb NOT NULL,
	"uses_sprints" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrum"."sprints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprints_state_valid" CHECK ("scrum"."sprints"."state" IN ('planned','active','completed')),
	CONSTRAINT "sprints_dates_ordered" CHECK ("scrum"."sprints"."ends_on" >= "scrum"."sprints"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "scrum"."tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'to_do' NOT NULL,
	"assignee_id" uuid,
	"estimate_minutes" integer,
	"priority" text DEFAULT 'normal' NOT NULL,
	"labels" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"due_on" date,
	"parent_id" uuid,
	"sprint_id" uuid,
	"rank" numeric(20, 10) NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tasks_priority_valid" CHECK ("scrum"."tasks"."priority" IN ('low','normal','high','urgent')),
	CONSTRAINT "tasks_estimate_sane" CHECK ("scrum"."tasks"."estimate_minutes" IS NULL OR ("scrum"."tasks"."estimate_minutes" > 0 AND "scrum"."tasks"."estimate_minutes" <= 100000)),
	CONSTRAINT "tasks_not_own_parent" CHECK ("scrum"."tasks"."parent_id" IS NULL OR "scrum"."tasks"."parent_id" <> "scrum"."tasks"."id")
);
--> statement-breakpoint
ALTER TABLE "time"."entries" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "scrum"."tasks" ADD CONSTRAINT "tasks_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "scrum"."sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprints_project_idx" ON "scrum"."sprints" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_one_active_per_project" ON "scrum"."sprints" USING btree ("project_id") WHERE "scrum"."sprints"."state" = 'active';--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "scrum"."tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_sprint_idx" ON "scrum"."tasks" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "scrum"."tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "scrum"."tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "entries_task_idx" ON "time"."entries" USING btree ("task_id");