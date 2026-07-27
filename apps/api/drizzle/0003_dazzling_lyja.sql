ALTER TABLE "time"."entries" DROP CONSTRAINT "entries_minutes_positive";--> statement-breakpoint
ALTER TABLE "time"."entries" DROP CONSTRAINT "entries_minutes_sane";--> statement-breakpoint
ALTER TABLE "time"."entries" ALTER COLUMN "minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."entries" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time"."entries" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_running_per_person" ON "time"."entries" USING btree ("person_id") WHERE "time"."entries"."started_at" IS NOT NULL AND "time"."entries"."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "time"."entries" ADD CONSTRAINT "entries_end_needs_start" CHECK ("time"."entries"."ended_at" IS NULL OR "time"."entries"."started_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "time"."entries" ADD CONSTRAINT "entries_end_after_start" CHECK ("time"."entries"."ended_at" IS NULL OR "time"."entries"."ended_at" > "time"."entries"."started_at");--> statement-breakpoint
ALTER TABLE "time"."entries" ADD CONSTRAINT "entries_measurable_or_running" CHECK ("time"."entries"."minutes" IS NOT NULL OR ("time"."entries"."started_at" IS NOT NULL AND "time"."entries"."ended_at" IS NULL));--> statement-breakpoint
ALTER TABLE "time"."entries" ADD CONSTRAINT "entries_minutes_positive" CHECK ("time"."entries"."minutes" IS NULL OR "time"."entries"."minutes" > 0);--> statement-breakpoint
ALTER TABLE "time"."entries" ADD CONSTRAINT "entries_minutes_sane" CHECK ("time"."entries"."minutes" IS NULL OR "time"."entries"."minutes" <= 1440);