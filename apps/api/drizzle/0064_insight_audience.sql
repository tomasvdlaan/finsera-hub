ALTER TABLE "insights"."insights" ADD COLUMN "audience" text;--> statement-breakpoint
CREATE INDEX "insights_audience_idx" ON "insights"."insights" USING btree ("audience");