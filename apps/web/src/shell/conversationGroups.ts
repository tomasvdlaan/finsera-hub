import type { ConversationSummary } from './conversation/index.js';

export interface DateGroup {
  key: string;
  label: string;
  items: ConversationSummary[];
}

/**
 * Today / Yesterday / This week / Earlier.
 *
 * Every chat application does this, and it is worth doing because it costs nothing to
 * maintain: the grouping is derived from a timestamp that is already there, so it stays
 * correct forever without anybody filing anything. On sixty-seven threads it is the single
 * biggest readability win available.
 *
 * Pinned conversations are lifted out into their own group rather than being scattered
 * through the dates. A pin means "I want this where I can see it", and leaving it under
 * Earlier because it has not been touched this month is the opposite of what was asked.
 *
 * `now` is a parameter so this can be tested without pretending to control the clock.
 */
export function groupByDate(
  items: ConversationSummary[],
  now: Date = new Date(),
): DateGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  const startOfMonth = new Date(startOfToday);
  startOfMonth.setDate(startOfMonth.getDate() - 30);

  const groups: DateGroup[] = [
    { key: 'pinned', label: 'Pinned', items: [] },
    { key: 'today', label: 'Today', items: [] },
    { key: 'yesterday', label: 'Yesterday', items: [] },
    { key: 'week', label: 'Previous 7 days', items: [] },
    { key: 'month', label: 'Previous 30 days', items: [] },
    { key: 'older', label: 'Older', items: [] },
  ];
  const at = (key: string) => groups.find((g) => g.key === key)!;

  for (const c of items) {
    if (c.pinnedAt) {
      at('pinned').items.push(c);
      continue;
    }
    const when = new Date(c.updatedAt);
    if (when >= startOfToday) at('today').items.push(c);
    else if (when >= startOfYesterday) at('yesterday').items.push(c);
    else if (when >= startOfWeek) at('week').items.push(c);
    else if (when >= startOfMonth) at('month').items.push(c);
    else at('older').items.push(c);
  }

  // An empty heading is noise; a list of six of them is a wall of headings and no content.
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Folders as a two-level tree, in the order the owner put them.
 *
 * Depth is capped server-side, so this trusts that and only looks one level down — a
 * recursive walk here would be machinery for a case the API refuses to create.
 */
export function folderTree<T extends { id: string; parentId: string | null; position: number; name: string }>(
  folders: T[],
): Array<{ folder: T; children: T[] }> {
  const byPosition = (a: T, b: T) => a.position - b.position || a.name.localeCompare(b.name);
  const tops = folders.filter((f) => !f.parentId).sort(byPosition);
  return tops.map((folder) => ({
    folder,
    children: folders.filter((f) => f.parentId === folder.id).sort(byPosition),
  }));
}
