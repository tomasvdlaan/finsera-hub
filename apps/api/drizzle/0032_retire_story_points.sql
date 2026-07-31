-- Retire story points.
--
-- The column was added beside minutes with a condition written into the schema: "if a sprint or
-- two goes by with these never set, the honest move is to drop the column rather than keep a
-- field the UI has to apologise for." Eleven cards were created and not one was pointed, while
-- ten of the eleven carried an estimate. The condition was met.
--
-- Two things drizzle-kit cannot know, both hand-written below.

-- 1. A frozen summary would outlive the column.
--
-- `sprints.summary` records the unit a sprint could honestly report when it closed, and that
-- jsonb is never rewritten — that is the point of it. No sprint has closed yet, so there is
-- nothing to transform, but "yet" is doing real work in that sentence: if one closes between
-- this migration being written and being run, dropping the column silently orphans a shape the
-- new SprintSummary type cannot describe. Fail loudly instead of guessing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM scrum.sprints
     WHERE summary IS NOT NULL AND summary->>'unit' = 'points'
  ) THEN
    RAISE EXCEPTION
      'A sprint closed reporting points. Write the summary jsonb transform before dropping the column.';
  END IF;
END $$;--> statement-breakpoint

-- 2. Both views select the column, and Postgres refuses to drop a column a view depends on.
--
-- Safe to drop outright rather than rebuild here: ScrumService.ensureReportingViews() drops and
-- recreates both on every boot, which is the same reason no migration has ever defined them.
DROP VIEW IF EXISTS scrum.v_tasks CASCADE;--> statement-breakpoint
DROP VIEW IF EXISTS scrum.v_sprints CASCADE;--> statement-breakpoint

ALTER TABLE "scrum"."tasks" DROP CONSTRAINT "tasks_points_sane";--> statement-breakpoint
ALTER TABLE "scrum"."tasks" DROP COLUMN "story_points";
