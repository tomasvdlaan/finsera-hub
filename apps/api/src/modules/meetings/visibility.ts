import { and, eq, exists, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Actor } from '@platform/contracts';
import { notes, noteViewers } from './meetings.schema.js';

/**
 * Who may see a meeting note.
 *
 * One predicate, used by every read — the list, a single note, the search, the ledger of open
 * actions. That is the whole design: the rule is written once and applied in the WHERE clause,
 * so a note this actor may not see does not come back rather than coming back and being
 * filtered afterwards. The two failures that pattern prevents are the ones that actually
 * happen — a new read path that forgets to filter, and a count taken before the filter.
 *
 * It also means an invisible note is indistinguishable from one that does not exist. That is
 * deliberate: "you may not see this meeting" tells you there is a meeting, and on a note whose
 * whole point is that it is private, the existence is most of the secret.
 *
 * The rule, in order:
 *
 * - **Restricted** notes are visible to the person who wrote it and to the accounts named in
 *   `note_viewers`. Nothing else reaches them — not project membership, and not being an
 *   admin. An admin bypass was considered and rejected: `restricted` exists for the meeting
 *   about a person, and a flag that management can read through is not the thing its name
 *   promises. Somebody would put a salary review behind it. Access is granted by adding a
 *   viewer, which is recorded with who granted it, rather than by holding a role.
 * - **Admins** see every note that is not restricted. They already hold every capability, and
 *   in practice somebody has to be able to clean up after a person leaves.
 * - **Unlinked** notes — no project — are visible to everyone internal. No project means no
 *   client material to protect, and failing open is right here: a stand-up nobody linked
 *   should not quietly vanish from the team that held it.
 * - Otherwise the note belongs to a project, and it is visible to that project's team.
 * - In every non-restricted case, the author sees their own note. Without that, writing a note
 *   for a project you are not on loses it the moment you save.
 *
 * `memberOf` is passed in rather than fetched here so this stays a pure function of the
 * actor's memberships — the caller resolves them once per request through the CRM's
 * `projectIdsFor`, instead of this running a subquery against another module's schema.
 */
export function visibleNotes(actor: Actor, memberOf: string[]): SQL | undefined {
  const me = actor.userId;

  /* A grant naming this actor. A correlated EXISTS rather than a join, so a note with two
     viewers is still one row in the result. */
  const named = exists(
    sql`(SELECT 1 FROM ${noteViewers} WHERE ${noteViewers.noteId} = ${notes.id} AND ${noteViewers.userId} = ${me})`,
  );
  const restricted = and(eq(notes.restricted, true), or(eq(notes.createdBy, me), named));

  if (actor.role === 'admin') return or(eq(notes.restricted, false), restricted);

  const ordinary = and(
    eq(notes.restricted, false),
    or(
      isNull(notes.projectId),
      eq(notes.createdBy, me),
      // `inArray` with an empty list generates `false`, which is the correct reading of
      // "on no projects" — but only because the branches above already cover the notes such
      // a person should still see.
      memberOf.length > 0 ? inArray(notes.projectId, memberOf) : undefined,
    ),
  );

  return or(ordinary, restricted);
}
