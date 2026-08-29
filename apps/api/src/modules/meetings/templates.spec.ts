import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc } from '@platform/note-doc';
import {
  TEMPLATES,
  TEMPLATE_LIST,
  bodyFor,
  carriedBody,
  standupBody,
  type BoardDigest,
  type Commitment,
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

/**
 * The block that opens a meeting on what the last ones left owed.
 *
 * Pure text assembly, so where it lands and how it reads are checked without a database, a
 * board or a previous meeting.
 */
describe('carriedBody', () => {
  const owed = (over: Partial<Commitment> = {}): Commitment => ({
    id: 'a1',
    text: 'Send them the DPA',
    assigneeId: null,
    dueOn: null,
    noteId: 'n1',
    noteTitle: 'Client check-in',
    meetingDate: '2026-08-15',
    state: 'undecided',
    taskId: null,
    ...over,
  });

  it('leaves a first meeting exactly as it was', () => {
    // Nothing owed is the ordinary case for a kick-off, and it should not gain an empty heading.
    expect(carriedBody(TEMPLATES.client_check_in.body, [])).toBe(TEMPLATES.client_check_in.body);
  });

  it('lands below the letterhead, not above it', () => {
    /*
     * The note is the one document here that leaves the building. A block prepended ahead of
     * the mark would bury the letterhead three lines down in something that gets printed.
     */
    const body = carriedBody(TEMPLATES.kick_off.body, [owed()]);
    expect(body.indexOf('![Finsera]')).toBeLessThan(body.indexOf('## Since last time'));
    expect(body.indexOf('---')).toBeLessThan(body.indexOf('## Since last time'));
  });

  it('opens the ceremony, above its own first heading', () => {
    // What is still owed is the first two minutes of the meeting or it is nothing.
    const body = carriedBody(TEMPLATES.kick_off.body, [owed()]);
    expect(body.indexOf('## Since last time')).toBeLessThan(body.indexOf('## Why this project exists'));
  });

  it('fills the heading a ceremony already has rather than adding a second', () => {
    /*
     * A check-in opens on "Since last time" and a table of what was promised — the hand-written
     * version of this. Two headings of the same name would not just look wrong: a section is
     * addressed by its heading text, so a duplicate makes the agent's writes ambiguous.
     */
    const body = carriedBody(TEMPLATES.client_check_in.body, [owed()]);
    expect(body.split('\n').filter((l) => l.trim() === '## Since last time')).toHaveLength(1);
    expect(body).toContain('- [ ] Send them the DPA');
    // The template's own table survives underneath it.
    expect(body).toContain('| What we promised | Where it stands |');
  });

  it('says which problem each one is, because they need different answers', () => {
    const body = carriedBody(TEMPLATES.kick_off.body, [
      owed(),
      owed({ id: 'a2', text: 'Migrate staging', state: 'undone', taskId: 't1' }),
    ]);
    // Undecided needs a decision here; undone is already work and needs none.
    expect(body).toContain('never accepted or dismissed');
    expect(body).toContain('on the board, not finished');
  });

  it('names where and when it was promised, and when it is due', () => {
    const body = carriedBody(TEMPLATES.kick_off.body, [owed({ dueOn: '2026-08-20' })]);
    expect(body).toContain('"Client check-in", 2026-08-15');
    expect(body).toContain('due 2026-08-20');
  });

  it('writes unticked boxes, so the question can be answered in the room', () => {
    const body = carriedBody(TEMPLATES.kick_off.body, [owed()]);
    expect(body).toContain('- [ ] Send them the DPA');
    expect(body).not.toContain('- [x]');
  });
});

/**
 * One place a commitment is recorded.
 *
 * Three templates asked for follow-up in a checkbox list as well as in a table and in the action
 * points panel — three places to write one thing, two of them invisible to every query in the
 * platform. Which of them was the record depended on where you happened to type.
 */
describe('where a commitment goes', () => {
  it('no template asks for a follow-up checklist in its body', () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(t.body).not.toContain('## Follow-up');
      expect(t.body).not.toContain('## Next step');
    }
  });

  it('keeps the tables a client actually reads', () => {
    // Prose about what was agreed, in a document that gets mailed out — not a tracker.
    expect(TEMPLATES.client_check_in.body).toContain('## What is next');
    expect(TEMPLATES.retrospective.body).toContain('| What we change | Owner | By when |');
  });
});

/**
 * A seeded body has to survive the editor that opens it.
 *
 * The body is written as Markdown and hydrated into a ProseMirror document the first time
 * somebody opens the note; anything the parser does not recognise comes back as visible
 * characters or disappears. A ledger that renders as literal `- [ ]` text — or loses the line
 * that says which meeting made the promise — would be wrong in the one place it is read.
 */
describe('the seeded ledger through the document', () => {
  const owed: Commitment = {
    id: 'a1',
    text: 'Send them the DPA',
    assigneeId: null,
    dueOn: '2026-08-20',
    noteId: 'n1',
    noteTitle: 'Client check-in',
    meetingDate: '2026-08-15',
    state: 'undecided',
    taskId: null,
  };

  // Both shapes: the ceremony that already owns the heading, and one that gains it.
  for (const name of ['client_check_in', 'kick_off'] as const) {
    it(`round-trips for ${name}`, () => {
      const round = docToMarkdown(markdownToDoc(carriedBody(TEMPLATES[name].body, [owed])));
      expect(round).toContain('Send them the DPA');
      // A real task item, not the characters "- [ ]".
      expect(round).toContain('- [ ] Send them the DPA');
      expect(round).toContain('"Client check-in", 2026-08-15');
      expect(round.split('\n').filter((l) => l.trim() === '## Since last time')).toHaveLength(1);
      // The letterhead still opens the document that gets printed.
      expect(round.indexOf('![Finsera]')).toBeLessThan(round.indexOf('## Since last time'));
    });
  }
});
