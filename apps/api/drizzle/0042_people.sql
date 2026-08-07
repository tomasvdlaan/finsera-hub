-- What the business knows about a person, as opposed to what the identity provider does.
--
-- Zitadel owns who somebody is: their subject, their email, whether they may sign in at all.
-- A core.users row is still created only on first login and keyed on oidc_subject — there is
-- deliberately no way to invent a person here, because a row with no subject would collide
-- with the real one the moment they actually signed in.
--
-- These four are the things only this platform has an opinion about, and none of them can be
-- read out of a token.
ALTER TABLE core.users
  ADD COLUMN IF NOT EXISTS job_title       text,
  ADD COLUMN IF NOT EXISTS started_on      date,
  -- Cents, like every other money column. This is what turns revenue into margin: until now
  -- the platform could say what a project earned and never what it cost to deliver.
  ADD COLUMN IF NOT EXISTS cost_rate_cents integer,
  -- The denominator every load and utilisation figure has been refusing to invent, because a
  -- fabricated 40 looks authoritative and is fiction.
  ADD COLUMN IF NOT EXISTS weekly_hours    integer;

-- Nonsense that is easier to refuse than to detect later. A negative cost rate would flip the
-- sign of every margin it touches; a 200-hour week is a typo that would quietly halve a
-- utilisation figure and look plausible doing it.
ALTER TABLE core.users
  ADD CONSTRAINT users_cost_rate_sane CHECK (cost_rate_cents IS NULL OR cost_rate_cents >= 0),
  ADD CONSTRAINT users_weekly_hours_sane CHECK (weekly_hours IS NULL OR (weekly_hours > 0 AND weekly_hours <= 80));
