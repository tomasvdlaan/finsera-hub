-- One dashboard per person.
--
-- A single jsonb column rather than a row per placement: the layout is only ever read and
-- written whole, so normalising it would buy a query nobody needs at the cost of an ordering
-- column and a delete-and-reinsert on every drag.
--
-- No shared or team dashboard, deliberately. The reason this exists is that a finance manager
-- and a developer do not want the same front door.
CREATE TABLE IF NOT EXISTS core.dashboards (
  user_id    uuid PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
  layout     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The layout must be an array. Everything finer — which widget keys are real, what a span may
-- be — is checked by the service, because that set lives in the frontend registry and changes
-- whenever a module ships a card. A CHECK constraint on it would need a migration every time.
ALTER TABLE core.dashboards
  ADD CONSTRAINT dashboards_layout_is_array CHECK (jsonb_typeof(layout) = 'array');
