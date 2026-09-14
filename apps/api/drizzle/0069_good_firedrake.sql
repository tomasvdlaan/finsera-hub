CREATE INDEX "attendees_user_idx" ON "meetings"."attendees" USING btree ("user_id");

--> statement-breakpoint
/*
 * Link the attendees already recorded to the colleagues they were.
 *
 * `attendees.user_id` existed as a column and was never written, so every meeting held so far
 * is visible only to whoever wrote it and to the project's team — which is the complaint this
 * migration answers. Without this, the fix applies from today onwards and the history stays
 * invisible to the people who sat through it.
 *
 * The same rule the application uses, and for the same reasons: an exact address wins; a
 * display name is accepted only when exactly one ACTIVE colleague answers to it, so two people
 * with one name link neither, and somebody who has left is never linked at all. Restricted
 * notes are unaffected by whatever this writes — the visibility predicate does not read this
 * column for them.
 */
UPDATE meetings.attendees AS a
SET user_id = COALESCE(
  (
    SELECT u.id FROM core.users u
    WHERE u.is_active AND a.email IS NOT NULL AND lower(u.email) = lower(btrim(a.email))
    LIMIT 1
  ),
  (
    SELECT u.id FROM core.users u
    WHERE u.is_active AND lower(u.display_name) = lower(btrim(a.name))
      AND (
        SELECT count(*) FROM core.users u2
        WHERE u2.is_active AND lower(u2.display_name) = lower(btrim(a.name))
      ) = 1
  )
)
WHERE a.user_id IS NULL;
