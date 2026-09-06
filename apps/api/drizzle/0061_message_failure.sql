-- Why an assistant answer failed.
--
-- The failure path already recorded the turn — a question that failed is still a question
-- that was asked — but it kept only `error.message`, as prose inside the message body. So a
-- failure could be read by a person and not found by a query, and everything that says *why*
-- (the provider's status and response body, the model, how far the run got) was discarded at
-- the moment it was in hand.
--
-- Partial index: failures are a tiny fraction of messages and are always read as "the recent
-- ones", so the index covers only the rows that have one.
ALTER TABLE "core"."messages" ADD COLUMN "failure" jsonb;--> statement-breakpoint
CREATE INDEX "messages_failure_idx" ON "core"."messages" USING btree ("created_at" DESC) WHERE "failure" IS NOT NULL;
