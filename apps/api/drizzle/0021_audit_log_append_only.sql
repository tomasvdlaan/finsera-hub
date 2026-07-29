-- The audit log becomes append-only.
--
-- Every other guarantee in this database protects a record: an issued invoice, a sent
-- quote, an invoiced hour. This one protects the account of what happened to them, which
-- is the thing you reach for precisely when something has gone wrong and somebody's
-- version of events is in doubt. A log that can be quietly edited answers that question
-- with whatever the last writer wanted it to say.
--
-- Both directions are blocked, and UPDATE is the more important of the two. A deleted row
-- leaves a gap in the id sequence and in the timeline; an altered one leaves nothing at
-- all, and is indistinguishable from the truth.
--
-- There is no exception for administrators, because an exception for administrators is
-- exactly the hole this closes: the entries most worth altering are the ones recording
-- what an administrator did. Retention, if it is ever needed, is a deliberate migration
-- that drops these triggers, runs, and puts them back — visible in the migration history
-- rather than in somebody's psql session.

CREATE OR REPLACE FUNCTION core.forbid_audit_log_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'The audit log is append-only — % on core.audit_log is not permitted', TG_OP
    USING HINT = 'To expire old entries, write a migration that drops this trigger, prunes, and restores it.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_update ON core.audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON core.audit_log
  FOR EACH ROW EXECUTE FUNCTION core.forbid_audit_log_changes();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_delete ON core.audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON core.audit_log
  FOR EACH ROW EXECUTE FUNCTION core.forbid_audit_log_changes();
--> statement-breakpoint

-- TRUNCATE bypasses row-level triggers entirely, so it needs its own statement-level one.
-- Without this the whole table can still be emptied in a single command, which is both
-- the easiest way to destroy the log and the one a row trigger would not notice.
DROP TRIGGER IF EXISTS audit_log_no_truncate ON core.audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON core.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_audit_log_changes();
