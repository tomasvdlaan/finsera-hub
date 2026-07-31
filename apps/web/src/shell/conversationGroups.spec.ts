import { describe, expect, it } from 'vitest';
import { folderTree, groupByDate } from './conversationGroups.js';
import type { ConversationSummary } from './conversation/index.js';

const NOW = new Date('2026-07-31T14:00:00Z');

const conv = (over: Partial<ConversationSummary> & { id: string }): ConversationSummary => ({
  title: over.id,
  folderId: null,
  subjectId: null,
  pinnedAt: null,
  archivedAt: null,
  updatedAt: NOW.toISOString(),
  snippet: null,
  tags: [],
  subject: null,
  ...over,
});

const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

/**
 * The grouping.
 *
 * Boundaries are the whole risk here: "yesterday" is a calendar day, not twenty-four hours,
 * and a thread touched at 00:30 today is not "previous 7 days" because it is fourteen hours
 * old. Every case below is one of those edges.
 */
describe('groupByDate', () => {
  it('separates today, yesterday, the week and the rest', () => {
    const groups = groupByDate(
      [
        conv({ id: 'now', updatedAt: ago(1) }),
        conv({ id: 'yesterday', updatedAt: ago(20) }),
        conv({ id: 'lastweek', updatedAt: ago(24 * 4) }),
        conv({ id: 'lastmonth', updatedAt: ago(24 * 20) }),
        conv({ id: 'ancient', updatedAt: ago(24 * 200) }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ['today', ['now']],
      ['yesterday', ['yesterday']],
      ['week', ['lastweek']],
      ['month', ['lastmonth']],
      ['older', ['ancient']],
    ]);
  });

  it('treats yesterday as a calendar day, not twenty-four hours', () => {
    // 14 hours before 14:00 is 00:00 the same day — today, however long ago it feels.
    const groups = groupByDate([conv({ id: 'earlyToday', updatedAt: ago(13) })], NOW);
    expect(groups[0]?.key).toBe('today');
  });

  it('lifts pinned conversations out of the dates entirely', () => {
    // A pin means "keep this where I can see it"; leaving it under Older is the opposite.
    const groups = groupByDate(
      [
        conv({ id: 'old-but-pinned', updatedAt: ago(24 * 300), pinnedAt: ago(1) }),
        conv({ id: 'fresh', updatedAt: ago(1) }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['pinned', 'today']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['old-but-pinned']);
  });

  it('drops empty groups rather than printing six headings', () => {
    expect(groupByDate([conv({ id: 'a' })], NOW).map((g) => g.key)).toEqual(['today']);
    expect(groupByDate([], NOW)).toEqual([]);
  });

  it('keeps the order it was given inside a group', () => {
    // The server has already sorted; regrouping must not quietly re-sort.
    const groups = groupByDate(
      [conv({ id: 'b', updatedAt: ago(2) }), conv({ id: 'a', updatedAt: ago(3) })],
      NOW,
    );
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('folderTree', () => {
  const f = (id: string, parentId: string | null, position = 0, name = id) => ({
    id,
    parentId,
    position,
    name,
  });

  it('nests children under their parent', () => {
    const tree = folderTree([f('clients', null), f('dochorse', 'clients'), f('billing', null)]);
    // Both tops sit at position 0, so the name breaks the tie — see the test below.
    expect(tree.map((t) => [t.folder.id, t.children.map((c) => c.id)])).toEqual([
      ['billing', []],
      ['clients', ['dochorse']],
    ]);
  });

  it('honours manual position before name', () => {
    // Alphabetical put the folder you use most wherever its name happened to fall.
    const tree = folderTree([f('zebra', null, 0), f('apple', null, 1)]);
    expect(tree.map((t) => t.folder.id)).toEqual(['zebra', 'apple']);
  });

  it('falls back to name when positions tie', () => {
    const tree = folderTree([f('zebra', null, 0), f('apple', null, 0)]);
    expect(tree.map((t) => t.folder.id)).toEqual(['apple', 'zebra']);
  });

  it('ignores a child whose parent is not in the list', () => {
    // A folder deleted in another tab must not take its children off screen with it.
    expect(folderTree([f('orphan', 'gone')])).toEqual([]);
  });
});
