-- A read-only role for external reporting clients (Power BI, or any SQL tool).
--
-- Only the ROLE is created here. The grants deliberately are not: the v_* views are
-- created at application boot, and ensureReportingViews() drops and recreates them —
-- which drops their grants with them. A grant written here would be correct exactly once
-- and then silently disappear on the next restart.
--
-- ReportingService re-applies the grants after every boot instead, which is the only
-- place that can be right every time.
--
-- Creating the role is not the same as exposing it. Reaching this database from outside
-- is a deployment decision, and NOLOGIN means this role cannot connect at all until a
-- password is set deliberately.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_readonly') THEN
    CREATE ROLE platform_readonly NOLOGIN;
  END IF;
END
$$;
