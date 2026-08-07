import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/auth.types.js';
import { DashboardService, STARTER_LAYOUT } from './dashboard.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';

const service = new DashboardService(testDb);

let userId: string;
let actor: Actor;

const layout = (over: Partial<{ id: string; widget: string; span: number }> = {}) => [
  { id: 'a', widget: 'scrum:doing', span: 6, ...over },
];

beforeEach(async () => {
  await resetDb();
  userId = crypto.randomUUID();
  await seedUser(userId);
  actor = { userId, role: 'member', permissions: new Set(['*']) } as unknown as Actor;
});

describe('a dashboard', () => {
  it('starts as the layout everybody gets, and says it is not customised', async () => {
    const got = await service.get(actor);
    expect(got.layout).toEqual(STARTER_LAYOUT);
    // The distinction matters to the UI: "reset" is only worth offering to somebody who has
    // something to reset.
    expect(got.custom).toBe(false);
  });

  it('does not write a row just because somebody looked', async () => {
    await service.get(actor);
    // Seeding on read would freeze the starter layout at whatever it was that day, so a person
    // who never customises anything would stop receiving improvements to the default.
    expect((await service.get(actor)).custom).toBe(false);
  });

  it('keeps what was saved, and remembers it was chosen', async () => {
    await service.save(actor, layout());
    const got = await service.get(actor);
    expect(got.custom).toBe(true);
    expect(got.layout).toEqual([{ id: 'a', widget: 'scrum:doing', span: 6, settings: {} }]);
  });

  it('replaces wholesale rather than merging', async () => {
    await service.save(actor, layout());
    await service.save(actor, [{ id: 'b', widget: 'time:fortnight', span: 4 }]);
    const got = await service.get(actor);
    // A drag rewrites the list; a save that merged would make removing a widget impossible.
    expect(got.layout.map((p) => p.id)).toEqual(['b']);
  });

  it('goes back to the default by forgetting, not by storing the default', async () => {
    await service.save(actor, layout());
    await service.reset(actor);
    const got = await service.get(actor);
    expect(got.custom).toBe(false);
    expect(got.layout).toEqual(STARTER_LAYOUT);
  });

  it('keeps two people apart', async () => {
    const otherId = crypto.randomUUID();
    await seedUser(otherId);
    const other = { userId: otherId, role: 'member' } as unknown as Actor;

    await service.save(actor, layout());
    expect((await service.get(other)).custom).toBe(false);
    expect((await service.get(actor)).custom).toBe(true);
  });

  it('carries settings through untouched', async () => {
    await service.save(actor, [
      { id: 'a', widget: 'time:project-burn', span: 6, settings: { projectId: 'abc', scope: 'mine' } },
    ]);
    const [placed] = (await service.get(actor)).layout;
    // The server does not interpret settings — a widget's options are its own business, and a
    // server that validated them would need to know every widget's schema.
    expect(placed?.settings).toEqual({ projectId: 'abc', scope: 'mine' });
  });
});

describe('what a layout may not be', () => {
  const rejects = async (input: unknown, because: string) => {
    await expect(service.save(actor, input), because).rejects.toThrow();
  };

  it('refuses anything that is not a list', async () => {
    await rejects({ widgets: [] }, 'an object is not a layout');
    await rejects(null, 'null is not a layout');
    await rejects('scrum:doing', 'a string is not a layout');
  });

  it('refuses a width the grid cannot express', async () => {
    // 5, 7 and 11 are not in the span set: a widget that can be any width has to be designed
    // for every width, and what happens instead is it is designed for one.
    await rejects(layout({ span: 5 }), '5 is not a span');
    await rejects(layout({ span: 0 }), 'zero is not a span');
    await rejects(layout({ span: 13 }), 'wider than the grid');
  });

  it('refuses a name that is not a widget name', async () => {
    await rejects(layout({ widget: 'doing' }), 'no module prefix');
    await rejects(layout({ widget: 'Scrum:Doing' }), 'not lower case');
    await rejects(layout({ widget: '' }), 'empty');
  });

  it('refuses two placements sharing an id', async () => {
    // The id is what a drag reorders and a remove deletes by. Two the same and the page would
    // move or delete the wrong one, which is the kind of bug that looks like a ghost.
    await rejects(
      [
        { id: 'a', widget: 'scrum:doing', span: 6 },
        { id: 'a', widget: 'time:fortnight', span: 6 },
      ],
      'duplicate id',
    );
  });

  it('allows the same widget twice under different ids', async () => {
    // This is the whole point of per-placement settings: burn for one project beside burn for
    // another.
    await service.save(actor, [
      { id: 'a', widget: 'time:project-burn', span: 6, settings: { projectId: 'one' } },
      { id: 'b', widget: 'time:project-burn', span: 6, settings: { projectId: 'two' } },
    ]);
    expect((await service.get(actor)).layout).toHaveLength(2);
  });

  it('refuses a dashboard nobody could read', async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ id: `w${i}`, widget: 'scrum:doing', span: 3 }));
    await rejects(many, 'past the cap');
  });

  it('refuses settings that are not short strings', async () => {
    await rejects([{ id: 'a', widget: 'scrum:doing', span: 6, settings: { n: 5 } }], 'a number');
    await rejects(
      [{ id: 'a', widget: 'scrum:doing', span: 6, settings: { n: 'x'.repeat(200) } }],
      'too long to be a setting',
    );
  });

  it('refuses a caller with no person behind it', async () => {
    const machine = { userId: null, role: 'system' } as unknown as Actor;
    await expect(service.get(machine)).rejects.toThrow(/belongs to a person/);
  });
});
