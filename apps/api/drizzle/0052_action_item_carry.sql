-- An action point can say which earlier commitment it repeats.
--
-- Carrying a promise into the next meeting meant typing it again, which produced a row
-- indistinguishable from a new commitment. With the ancestor recorded, the same promise asked
-- for a fourth week is visibly the same promise — and the ledger that seeds the next meeting
-- can skip what it has already carried instead of listing it twice.
--
-- A plain uuid rather than a self-referencing foreign key: `scrum.tasks.parent_id` models the
-- same shape the same way, and every read joins back through it rather than trusting it.
ALTER TABLE "meetings"."action_items" ADD COLUMN "carried_from" uuid;--> statement-breakpoint
CREATE INDEX "action_items_carried_from_idx" ON "meetings"."action_items" USING btree ("carried_from");--> statement-breakpoint
ALTER TABLE "meetings"."action_items" ADD CONSTRAINT "action_items_not_own_ancestor" CHECK ("meetings"."action_items"."carried_from" IS NULL OR "meetings"."action_items"."carried_from" <> "meetings"."action_items"."id");