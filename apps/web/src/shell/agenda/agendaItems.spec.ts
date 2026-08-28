import { describe, expect, it } from 'vitest';
import {
  bandSpan,
  dueTone,
  fromActions,
  fromInvoices,
  fromMeetings,
  fromQuotes,
  fromSprints,
  fromTasks,
  fromTimeDays,
  itemsOnDay,
  sortItems,
  upcoming,
  withinWindow,
} from './agendaItems.js';

const TODAY = '2026-06-10';
const money = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

describe('dueTone', () => {
  it('is danger in the past, warning today, plain in the future', () => {
    expect(dueTone('2026-06-09', TODAY)).toBe('danger');
    expect(dueTone(TODAY, TODAY)).toBe('warning');
    expect(dueTone('2026-06-11', TODAY)).toBe('neutral');
  });
});

describe('fromMeetings', () => {
  const held = {
    id: 'm1',
    title: 'Sprint review',
    meetingDate: '2026-06-10',
    startedAt: '2026-06-10T13:00:00.000Z',
    endedAt: '2026-06-10T14:00:00.000Z',
    status: 'draft',
    clientName: 'DocHorse',
  };
  const writtenUp = {
    id: 'm2',
    title: 'Call with the bookkeeper',
    meetingDate: '2026-06-09',
    startedAt: null,
    endedAt: null,
    status: 'final',
  };

  it('draws a meeting that was held as a timed block', () => {
    const [item] = fromMeetings([held]);
    expect(item).toMatchObject({
      id: 'meeting:m1',
      shape: 'timed',
      at: '2026-06-10T13:00:00.000Z',
      until: '2026-06-10T14:00:00.000Z',
      tone: 'accent',
      href: '/meetings/m1',
      detail: 'DocHorse',
    });
  });

  it('draws a note written up afterwards as a marker, not an invented hour', () => {
    const [item] = fromMeetings([writtenUp]);
    expect(item).toMatchObject({ shape: 'marker', at: '2026-06-09', tone: 'neutral' });
    expect(item!.until).toBeUndefined();
  });
});

describe('fromSprints', () => {
  it('becomes a band from its planned start to its planned end', () => {
    const [item] = fromSprints([
      { id: 's1', name: 'Sprint 4', startsOn: '2026-06-08', endsOn: '2026-06-19', state: 'active' },
    ]);
    expect(item).toMatchObject({
      id: 'sprint:s1',
      shape: 'band',
      at: '2026-06-08',
      until: '2026-06-19',
      tone: 'accent',
      href: '/board/sprints/s1',
    });
  });

  it('is plain when it has not started or has closed', () => {
    const items = fromSprints([
      { id: 's2', name: 'Sprint 5', startsOn: '2026-06-22', endsOn: '2026-07-03', state: 'planned' },
      { id: 's3', name: 'Sprint 3', startsOn: '2026-05-25', endsOn: '2026-06-05', state: 'completed' },
    ]);
    expect(items.map((i) => i.tone)).toEqual(['neutral', 'neutral']);
  });
});

describe('fromTasks', () => {
  const task = (over: Partial<Parameters<typeof fromTasks>[0][number]> = {}) => ({
    id: 't1',
    title: 'Model purchasing spend dataset',
    dueOn: '2026-06-10',
    completedAt: null,
    flow: 'active',
    ...over,
  });

  it('keeps an open card with a deadline, as a marker', () => {
    const [item] = fromTasks([task()], TODAY);
    expect(item).toMatchObject({ id: 'task:t1', shape: 'marker', tone: 'warning', href: '/tasks/t1' });
  });

  it('drops cards with no deadline, and cards that are finished', () => {
    expect(fromTasks([task({ dueOn: null })], TODAY)).toHaveLength(0);
    expect(fromTasks([task({ completedAt: '2026-06-09T10:00:00Z' })], TODAY)).toHaveLength(0);
    // A met deadline is not news, however the card got there.
    expect(fromTasks([task({ flow: 'done' })], TODAY)).toHaveLength(0);
  });

  it('is danger once the day has passed', () => {
    const [item] = fromTasks([task({ dueOn: '2026-06-09' })], TODAY);
    expect(item!.tone).toBe('danger');
  });
});

describe('fromActions', () => {
  it('carries the meeting it came out of as its detail', () => {
    const [item] = fromActions(
      [{ id: 'a1', text: 'Send the revised scope', dueOn: '2026-06-12', noteId: 'm1', noteTitle: 'Sprint review' }],
      TODAY,
    );
    expect(item).toMatchObject({ shape: 'marker', href: '/meetings/m1', detail: 'Sprint review', tone: 'neutral' });
  });

  it('drops an action nobody put a date on', () => {
    expect(
      fromActions([{ id: 'a2', text: 'Think about it', dueOn: null, noteId: 'm1', noteTitle: 'x' }], TODAY),
    ).toHaveLength(0);
  });
});

describe('fromInvoices', () => {
  const invoice = (over: Partial<Parameters<typeof fromInvoices>[0][number]> = {}) => ({
    id: 'i1',
    number: '2026-0007',
    status: 'issued',
    dueOn: '2026-06-08',
    totalCents: 8700,
    ...over,
  });

  it('shows an issued invoice past its date in danger, with the amount', () => {
    const [item] = fromInvoices([invoice()], TODAY, money);
    expect(item).toMatchObject({ title: 'Invoice 2026-0007', tone: 'danger', detail: '€ 87.00' });
  });

  it('never calls a draft overdue — nobody has been asked to pay it', () => {
    const [item] = fromInvoices([invoice({ status: 'draft', number: null })], TODAY, money);
    expect(item).toMatchObject({ title: 'Draft invoice', tone: 'info' });
  });

  it('drops paid and void', () => {
    expect(fromInvoices([invoice({ status: 'paid' })], TODAY, money)).toHaveLength(0);
    expect(fromInvoices([invoice({ status: 'void' })], TODAY, money)).toHaveLength(0);
  });
});

describe('fromQuotes', () => {
  it('only a sent quote can expire', () => {
    const rows = [
      { id: 'q1', number: 'Q1', title: 'Power BI portal', status: 'sent', validUntil: '2026-06-15' },
      { id: 'q2', number: 'Q2', title: 'Draft', status: 'draft', validUntil: '2026-06-15' },
      { id: 'q3', number: 'Q3', title: 'Won', status: 'accepted', validUntil: '2026-06-15' },
    ];
    const items = fromQuotes(rows, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'quote:q1', title: 'Power BI portal', shape: 'marker' });
  });
});

describe('fromTimeDays', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    startedAt: '2026-06-10T08:00:00.000Z',
    endedAt: '2026-06-10T10:30:00.000Z',
    projectName: 'Power BI',
    description: 'Dataset modelling',
    billable: true,
    running: false,
    ...over,
  });

  it('draws a finished, timed entry', () => {
    const [item] = fromTimeDays([{ date: '2026-06-10', entries: [entry()] }]);
    expect(item).toMatchObject({
      id: 'logged:e1',
      shape: 'timed',
      title: 'Dataset modelling',
      tone: 'ok',
      detail: 'Power BI',
    });
  });

  it('is plain when the hour is not billable', () => {
    const [item] = fromTimeDays([{ date: '2026-06-10', entries: [entry({ billable: false })] }]);
    expect(item!.tone).toBe('neutral');
  });

  it('refuses to place an entry that has no position on the clock', () => {
    // A manual entry is a number of minutes against a day. Inventing an hour for it is the
    // one thing that makes a data product untrustworthy.
    expect(fromTimeDays([{ date: '2026-06-10', entries: [entry({ startedAt: null, endedAt: null })] }])).toHaveLength(0);
    expect(fromTimeDays([{ date: '2026-06-10', entries: [entry({ endedAt: null, running: true })] }])).toHaveLength(0);
  });

  it('falls back to the project when the entry has no description', () => {
    const [item] = fromTimeDays([{ date: '2026-06-10', entries: [entry({ description: null })] }]);
    expect(item!.title).toBe('Power BI');
  });
});

describe('bandSpan', () => {
  const week = ['2026-06-08', '2026-06-14'] as const;
  const sprint = fromSprints([
    { id: 's1', name: 'Sprint 4', startsOn: '2026-06-08', endsOn: '2026-06-19', state: 'active' },
  ])[0]!;

  it('counts both ends — Monday to Friday is five days, not four', () => {
    const short = fromSprints([
      { id: 's9', name: 'Short', startsOn: '2026-06-08', endsOn: '2026-06-12', state: 'active' },
    ])[0]!;
    expect(bandSpan(short, week[0], week[1])).toEqual({
      offset: 0,
      days: 5,
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it('clips to the window without under-reporting the sprint', () => {
    expect(bandSpan(sprint, week[0], week[1])).toEqual({
      offset: 0,
      days: 7,
      clippedStart: false,
      clippedEnd: true,
    });
  });

  it('offsets a band that starts mid-window', () => {
    const mid = fromSprints([
      { id: 's8', name: 'Mid', startsOn: '2026-06-11', endsOn: '2026-06-12', state: 'planned' },
    ])[0]!;
    expect(bandSpan(mid, week[0], week[1])).toMatchObject({ offset: 3, days: 2 });
  });

  it('returns null for a band that misses the window entirely', () => {
    const past = fromSprints([
      { id: 's7', name: 'Old', startsOn: '2026-05-01', endsOn: '2026-05-14', state: 'completed' },
    ])[0]!;
    expect(bandSpan(past, week[0], week[1])).toBeNull();
  });
});

describe('itemsOnDay', () => {
  it('matches a band on every day it covers, and the others on their own day', () => {
    const items = [
      ...fromSprints([{ id: 's1', name: 'Sprint 4', startsOn: '2026-06-08', endsOn: '2026-06-19', state: 'active' }]),
      ...fromTasks([{ id: 't1', title: 'A card', dueOn: '2026-06-11', completedAt: null, flow: 'active' }], TODAY),
    ];
    expect(itemsOnDay(items, '2026-06-09').map((i) => i.kind)).toEqual(['sprint']);
    expect(itemsOnDay(items, '2026-06-11').map((i) => i.kind)).toEqual(['sprint', 'task']);
    expect(itemsOnDay(items, '2026-06-20')).toHaveLength(0);
  });
});

describe('sortItems', () => {
  it('puts bands first, then the clock, then deadlines', () => {
    const items = sortItems([
      ...fromTasks([{ id: 't1', title: 'A card', dueOn: '2026-06-10', completedAt: null, flow: 'active' }], TODAY),
      ...fromMeetings([
        {
          id: 'm1',
          title: 'Review',
          meetingDate: '2026-06-10',
          startedAt: '2026-06-10T13:00:00.000Z',
          endedAt: null,
          status: 'draft',
        },
      ]),
      ...fromSprints([{ id: 's1', name: 'Sprint 4', startsOn: '2026-06-08', endsOn: '2026-06-19', state: 'active' }]),
    ]);
    expect(items.map((i) => i.shape)).toEqual(['band', 'timed', 'marker']);
  });
});

describe('withinWindow', () => {
  it('keeps a band that merely overlaps the window', () => {
    const items = fromSprints([
      { id: 's1', name: 'Sprint 4', startsOn: '2026-06-01', endsOn: '2026-06-19', state: 'active' },
    ]);
    expect(withinWindow(items, '2026-06-08', '2026-06-14')).toHaveLength(1);
    expect(withinWindow(items, '2026-06-22', '2026-06-28')).toHaveLength(0);
  });
});

describe('upcoming', () => {
  it('ranks by how urgent, then by when — not chronologically', () => {
    const items = [
      ...fromTasks(
        [
          { id: 't1', title: 'Due in a week', dueOn: '2026-06-17', completedAt: null, flow: 'active' },
          { id: 't2', title: 'Late', dueOn: '2026-06-02', completedAt: null, flow: 'active' },
          { id: 't3', title: 'Today', dueOn: TODAY, completedAt: null, flow: 'active' },
        ],
        TODAY,
      ),
    ];
    expect(upcoming(items, TODAY).map((i) => i.title)).toEqual(['Late', 'Today', 'Due in a week']);
  });

  it('drops anything past the horizon', () => {
    const items = fromTasks(
      [{ id: 't4', title: 'Far off', dueOn: '2026-08-01', completedAt: null, flow: 'active' }],
      TODAY,
    );
    expect(upcoming(items, TODAY)).toHaveLength(0);
  });

  it('carries no meetings at all — held or written up afterwards', () => {
    // The regression this exists for: a note written up later has no start and no end, so it
    // is marker-shaped, and a shape test put four stand-ups from last month under "closing in"
    // next to a subtitle reading "Nothing is late". A meeting is never an obligation.
    const items = fromMeetings([
      {
        id: 'm1',
        title: 'Held at an hour',
        meetingDate: '2026-06-11',
        startedAt: '2026-06-11T13:00:00.000Z',
        endedAt: null,
        status: 'draft',
      },
      {
        id: 'm2',
        title: 'Written up afterwards',
        meetingDate: '2026-06-11',
        startedAt: null,
        endedAt: null,
        status: 'final',
      },
    ]);
    expect(items.map((i) => i.shape)).toEqual(['timed', 'marker']);
    expect(upcoming(items, TODAY)).toHaveLength(0);
  });

  it('keeps an obligation that is long overdue, however far back it goes', () => {
    // No floor on purpose: an invoice from March that nobody paid is not less relevant for
    // being old, and dropping it would make the rail quietly stop mentioning the worst case.
    const items = fromInvoices(
      [{ id: 'i9', number: '2026-0001', status: 'issued', dueOn: '2026-03-01', totalCents: 500_00 }],
      TODAY,
      money,
    );
    expect(upcoming(items, TODAY).map((i) => i.tone)).toEqual(['danger']);
  });
});
