import { describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  TEMPLATE_LIST,
  bodyFor,
  standupBody,
  type BoardDigest,
} from './templates.js';

/**
 * The shape a ceremony starts in.
 *
 * Pure text assembly, and worth testing because the stand-up is the one template whose body
 * depends on who is in the room — the rest is static and cannot be wrong.
 */
describe('bodyFor', () => {
  it('gives every person in the room their own block', () => {
    const body = bodyFor(TEMPLATES.daily_standup, [{ name: 'Tomas' }, { name: 'Anna' }]);

    expect(body).toContain('### Tomas');
    expect(body).toContain('### Anna');
    // A stand-up is several short conversations; the point is a place to stand in each one.
    expect(body.match(/- Blockers:/g)).toHaveLength(2);
    expect(body).toContain('## Sprint goal');
  });

  it('leaves the template alone when nobody is listed yet', () => {
    const body = bodyFor(TEMPLATES.daily_standup, []);
    expect(body).toBe(TEMPLATES.daily_standup.body);
    expect(body).not.toContain('{name}');
  });

  it('does not invent per-person blocks for a ceremony that has none', () => {
    const body = bodyFor(TEMPLATES.sprint_planning, [{ name: 'Tomas' }]);
    expect(body).toBe(TEMPLATES.sprint_planning.body);
    expect(body).not.toContain('### Tomas');
  });

  it('substitutes every occurrence, not just the first', () => {
    const body = bodyFor(
      { ...TEMPLATES.daily_standup, perAttendee: '### {name}\n\n{name} said:\n' },
      [{ name: 'Tomas' }],
    );
    expect(body).not.toContain('{name}');
  });
});

describe('the ceremonies', () => {
  it('covers the SCRUM ceremonies, which were all missing', () => {
    const names = TEMPLATE_LIST.map((t) => t.name);
    expect(names).toContain('daily_standup');
    expect(names).toContain('sprint_planning');
    expect(names).toContain('sprint_review');
    expect(names).toContain('retrospective');
  });

  it('gives every template a timebox, since the room shows elapsed against it', () => {
    // A missing one would silently render as no timebox rather than as an error.
    expect(TEMPLATE_LIST.every((t) => t.timeboxMinutes > 0)).toBe(true);
    expect(TEMPLATES.daily_standup.timeboxMinutes).toBe(15);
  });
});

/**
 * A stand-up that already knows what happened.
 *
 * Pure, so the shape of the note is checked without a board, a database or a clock. The
 * digest is the seam: scrum fills it in, and nothing here has heard of scrum.
 */
describe('standupBody', () => {
  const standup = TEMPLATES.daily_standup!;
  const empty: BoardDigest = { sprintGoal: null, people: [], blocked: [] };

  it('writes the sprint goal under its own heading', () => {
    const body = standupBody(standup, [], { ...empty, sprintGoal: 'Ship the supplier page' });
    expect(body).toMatch(/## Sprint goal\n\nShip the supplier page/);
  });

  it('fills yesterday from what a person actually moved, and leaves today blank', () => {
    // Today is the one thing the board cannot know and the only thing worth saying out loud.
    const body = standupBody(standup, [{ name: 'Tomas' }], {
      ...empty,
      people: [{ name: 'Tomas', moved: ['Model the spend dataset'], doing: ['Supplier page'] }],
    });
    expect(body).toContain('### Tomas');
    expect(body).toMatch(/- Yesterday:\n {2}- Model the spend dataset/);
    expect(body).toContain('- Today: \n');
    expect(body).toMatch(/- In flight:\n {2}- Supplier page/);
  });

  it('gives an attendee the board knows nothing about the blank block they had before', () => {
    const body = standupBody(standup, [{ name: 'Newcomer' }], empty);
    expect(body).toContain('### Newcomer');
    expect(body).toContain('- Yesterday: ');
    expect(body).toContain('- In flight: nothing');
  });

  it('says so when nothing is blocked, rather than leaving the heading bare', () => {
    // An empty heading reads as "not filled in yet". A sentence reads as an answer.
    expect(standupBody(standup, [], empty)).toContain('_Nothing is recorded as blocked._');
  });

  it('names blockers with their reason and their age', () => {
    const body = standupBody(standup, [], {
      ...empty,
      blocked: [{ title: 'Supplier page', reason: 'waiting on credentials', days: 4 }],
    });
    expect(body).toContain('- **Supplier page** — waiting on credentials _(4d)_');
  });

  it('leaves bodyFor exactly as it was', () => {
    // The two answer different questions: what does this template start as, versus what does
    // this stand-up open with. Only the second one reads a board.
    expect(bodyFor(standup, [{ name: 'Tomas' }])).toBe(
      [standup.body.trimEnd(), '', standup.perAttendee!.replace(/\{name\}/g, 'Tomas')].join('\n'),
    );
  });
});
