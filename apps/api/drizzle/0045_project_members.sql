-- Who works on a project, as opposed to who is accountable for it.
--
-- `projects.owner_id` has existed since Phase 1 and holds exactly one person: the commercial
-- owner, the one answerable for the engagement. It was never a statement about who does the
-- work, and it is exposed nowhere in the UI, so in practice the platform has never known who
-- is on anything. Every screen that wants to say "your projects", every assignee picker, and
-- every per-person view has had nothing to read.
--
-- Deliberately INFORMATIONAL, not access control. `PermissionService.canSee()` stays
-- permissive: everyone continues to see every record. Its own comment has proposed scoping by
-- team membership since v0, and this table is the shape that would make that possible — but
-- turning it on is a separate decision with a real failure mode (somebody locked out of the
-- project they are mid-delivery on), and it is not this one.
--
-- Modelled on scrum.sprint_capacity: a composite primary key, `user_id` as a bare uuid with no
-- cross-schema foreign key, and a cascade from the owning side only. A membership is a join
-- row, not a record with a name and a URL, so it is not registered as an entity either.

CREATE TABLE IF NOT EXISTS crm.project_members (
  project_id uuid NOT NULL REFERENCES crm.projects (id) ON DELETE CASCADE,
  -- core.users id. No cross-schema FK, the same rule every other module follows.
  user_id    uuid NOT NULL,
  /*
   * What they are on it, not what they are.
   *
   * 'lead' is a statement about this project; a person can lead one and contribute to another
   * on the same afternoon. It is deliberately not a job title — that lives on core.users and
   * describes the person rather than the engagement.
   */
  role       text NOT NULL DEFAULT 'contributor',
  added_at   timestamptz NOT NULL DEFAULT now(),
  added_by   uuid,

  PRIMARY KEY (project_id, user_id),
  CONSTRAINT project_members_role_known CHECK (role IN ('lead', 'contributor'))
);

-- The two questions this table exists to answer: who is on this project, and what is this
-- person on. The composite PK already indexes the first; the second needs its own.
CREATE INDEX IF NOT EXISTS project_members_user_idx ON crm.project_members (user_id);

/*
 * At most one lead per project.
 *
 * A partial unique index rather than a check, because the constraint is across rows. Two leads
 * is not a richer model, it is an unanswered question — every screen that prints "led by" would
 * have to pick one, and they would not all pick the same one.
 */
CREATE UNIQUE INDEX IF NOT EXISTS project_members_one_lead
  ON crm.project_members (project_id)
  WHERE role = 'lead';
