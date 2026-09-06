ALTER TABLE "insights"."insights" ADD COLUMN "person_id" uuid;--> statement-breakpoint
CREATE INDEX "insights_person_idx" ON "insights"."insights" USING btree ("person_id");