ALTER TABLE "time"."entries" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."entries" ALTER COLUMN "billable" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "time"."entries" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "time"."entries" ADD CONSTRAINT "entries_one_target" CHECK ("time"."entries"."project_id" IS NULL OR "time"."entries"."client_id" IS NULL);--> statement-breakpoint
ALTER TABLE "time"."entries" ADD CONSTRAINT "entries_billable_needs_target" CHECK ("time"."entries"."billable" = false OR "time"."entries"."project_id" IS NOT NULL OR "time"."entries"."client_id" IS NOT NULL);