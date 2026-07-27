-- The reporting views select submitted_at, so they must go before the column can.
-- They are rebuilt at boot by TimeService.ensureReportingViews().
DROP VIEW IF EXISTS "time".v_entries CASCADE;
--> statement-breakpoint
DROP VIEW IF EXISTS "time".v_weekly_totals CASCADE;
--> statement-breakpoint
ALTER TABLE "time"."entries" DROP COLUMN "submitted_at";