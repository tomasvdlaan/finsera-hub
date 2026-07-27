-- Invoiced hours are frozen, enforced by the database rather than by TimeService's
-- good manners — the same standard billing.invoices already holds itself to.
--
-- The columns describing the WORK are frozen; the columns describing its BILLING are
-- not. That asymmetry is the whole design: a credit note must be able to release these
-- hours (set invoice_id and invoiced_at back to null) so corrected hours can be
-- re-billed. Freezing everything would make crediting impossible.

CREATE OR REPLACE FUNCTION "time".forbid_invoiced_entry_changes()
RETURNS trigger AS $$
BEGIN
  IF OLD.invoiced_at IS NULL THEN
    RETURN NEW; -- not invoiced yet: ordinary editing, nothing to protect
  END IF;

  IF NEW.person_id  IS DISTINCT FROM OLD.person_id
  OR NEW.project_id IS DISTINCT FROM OLD.project_id
  OR NEW.task_id    IS DISTINCT FROM OLD.task_id
  OR NEW.worked_on  IS DISTINCT FROM OLD.worked_on
  OR NEW.started_at IS DISTINCT FROM OLD.started_at
  OR NEW.ended_at   IS DISTINCT FROM OLD.ended_at
  OR NEW.minutes    IS DISTINCT FROM OLD.minutes
  OR NEW.billable   IS DISTINCT FROM OLD.billable
  OR NEW.description IS DISTINCT FROM OLD.description
  THEN
    RAISE EXCEPTION
      'Time entry % is on an issued invoice and cannot be changed — credit the invoice first',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "time".forbid_invoiced_entry_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.invoiced_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Time entry % is on an issued invoice and cannot be deleted — credit the invoice first',
      OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS entries_immutable_when_invoiced ON "time".entries;
--> statement-breakpoint
CREATE TRIGGER entries_immutable_when_invoiced
  BEFORE UPDATE ON "time".entries
  FOR EACH ROW EXECUTE FUNCTION "time".forbid_invoiced_entry_changes();
--> statement-breakpoint

DROP TRIGGER IF EXISTS entries_no_delete_when_invoiced ON "time".entries;
--> statement-breakpoint
CREATE TRIGGER entries_no_delete_when_invoiced
  BEFORE DELETE ON "time".entries
  FOR EACH ROW EXECUTE FUNCTION "time".forbid_invoiced_entry_delete();
