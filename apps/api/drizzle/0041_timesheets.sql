-- A person's week, and whether anybody has looked at it.
--
-- This overturns a decision written into billing.service.ts: "there is no submission step — a
-- logged hour with a duration is a billable hour, and the draft is where the work gets
-- reviewed". That holds for one person and stops holding at two, because whoever assembles the
-- invoice can review their own hours from memory and cannot tell whether somebody else's
-- four-hour entry was finished work or a mid-thought they meant to split.
--
-- Additive on purpose. A week with no row here behaves exactly as it always did, so applying
-- this changes no existing number and blocks no existing invoice.
CREATE TABLE IF NOT EXISTS time.timesheets (
  id           uuid PRIMARY KEY,
  person_id    uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  week_of      date NOT NULL,
  status       text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid REFERENCES core.users(id),
  note         text,

  CONSTRAINT timesheets_status_known CHECK (status IN ('submitted','approved','returned')),

  -- Sending a week back without saying why is the same as not sending it back: the person gets
  -- a badge and no idea what to change. Enforced here rather than trusted to every caller.
  CONSTRAINT timesheets_returned_needs_reason
    CHECK (status <> 'returned' OR (note IS NOT NULL AND length(btrim(note)) > 0)),

  -- A decision has a decider and a moment, or it has neither. A row claiming to be approved
  -- with no idea who approved it is exactly the row an approval exists to prevent.
  CONSTRAINT timesheets_decision_is_whole
    CHECK ((status = 'submitted') = (decided_at IS NULL AND decided_by IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS timesheets_person_week ON time.timesheets (person_id, week_of);
CREATE INDEX IF NOT EXISTS timesheets_status ON time.timesheets (status);

-- Every week starts on a Monday in this system. A row keyed to a Wednesday would silently
-- overlap the weeks either side of it and make "this week's hours" ambiguous.
ALTER TABLE time.timesheets
  ADD CONSTRAINT timesheets_week_starts_monday CHECK (EXTRACT(ISODOW FROM week_of) = 1);
