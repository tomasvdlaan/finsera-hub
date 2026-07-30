ALTER TABLE "scrum"."tasks" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "scrum"."tasks" ADD COLUMN "blocked_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scrum"."tasks" ADD COLUMN "blocked_on_user_id" uuid;--> statement-breakpoint
CREATE INDEX "tasks_blocked_idx" ON "scrum"."tasks" USING btree ("blocked_since");--> statement-breakpoint
ALTER TABLE "scrum"."tasks" ADD CONSTRAINT "tasks_blocked_is_complete" CHECK (("scrum"."tasks"."blocked_reason" IS NULL) = ("scrum"."tasks"."blocked_since" IS NULL));