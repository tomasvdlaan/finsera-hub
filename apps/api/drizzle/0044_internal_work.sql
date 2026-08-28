-- Work that is ours rather than a client's.
--
-- A project needs a client and a task needs a project, so work belonging to nobody's
-- engagement still needs both to hang off. Rather than make either nullable — which reaches
-- into the board (one per project, its columns the only valid statuses), the portal, and
-- every profitability figure — one client and one project are marked as us.
--
-- The flag rather than the name, because a name is a thing somebody renames on a Tuesday.
-- crm.v_projects excludes internal projects, which is what keeps this out of margin,
-- budget burn and the client portal without teaching each of them about it separately.
ALTER TABLE crm.clients ADD COLUMN is_internal boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE crm.projects ADD COLUMN is_internal boolean NOT NULL DEFAULT false;
