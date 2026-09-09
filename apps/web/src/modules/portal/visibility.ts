/** Who may open one report or one document: everyone at the client, or named people. */
export interface Visibility {
  mode: 'everyone' | 'restricted';
  /** `portal.users` ids. Kept when the mode is `everyone`, so restricting again restores them. */
  userIds: string[];
}

/**
 * Whether this is a state the server will accept, and therefore whether to send it.
 *
 * "Restricted to nobody" is the only draft that is not. It is a real thing to have on screen —
 * it is what the panel looks like between choosing to restrict something and choosing to whom,
 * and between unticking the last person and ticking another — and it is not a thing to store,
 * because an artefact restricted to nobody is an artefact nobody can open.
 *
 * Separated from the component because getting this wrong is invisible: the first version
 * refused the *choice* rather than the save, so "only these people" was disabled until somebody
 * was ticked, while ticking somebody first saved a grant against a still-shared-with-everyone
 * artefact and changed nothing anybody could see. Both halves looked like they worked.
 */
export const savable = (v: Visibility): boolean =>
  v.mode === 'everyone' || v.userIds.length > 0;

/** Add or remove one person, leaving the mode alone. */
export const toggleUser = (v: Visibility, userId: string): Visibility => ({
  ...v,
  userIds: v.userIds.includes(userId)
    ? v.userIds.filter((u) => u !== userId)
    : [...v.userIds, userId],
});

/**
 * The one line a list row shows.
 *
 * Always describes what is *stored*, never what is being drafted: a row in a table is read as
 * a statement about the world, and a half-finished edit that reads as fact is worse than one
 * that reads as nothing. One name is worth printing — "Only Charlotte" answers the question
 * outright — where four are a number.
 */
export function summarise(v: Visibility, nameOf: (id: string) => string | null): string {
  if (v.mode === 'everyone') return 'Everyone';
  if (v.userIds.length === 1) return `Only ${nameOf(v.userIds[0]!) ?? '1 person'}`;
  return `Only ${v.userIds.length} people`;
}
