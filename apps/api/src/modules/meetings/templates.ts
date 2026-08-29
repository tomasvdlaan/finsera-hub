/**
 * Meeting templates.
 *
 * A template is an agenda plus a skeleton body, nothing cleverer. They exist because the
 * hardest part of taking notes is starting, and because 6c needs an agenda to detect a
 * meeting drifting away from what it was for.
 *
 * Deliberately few. A template nobody uses is worse than no template — it becomes a menu
 * to read past every time.
 *
 * No body here asks for follow-up in a checkbox list any more. Three templates did, alongside a
 * "what is next" table and the action points panel — three places to write one commitment, two
 * of them invisible to every query in the platform, so which of them was the record depended on
 * where you happened to type. The panel is the record; the tables that survive are the prose a
 * client reads, not a tracking mechanism.
 */
import type { Eagerness } from './live/eagerness.js';

export interface Template {
  label: string;
  description: string;
  agenda: string[];
  body: string;
  /**
   * How long this ceremony is supposed to take.
   *
   * A property of the ceremony rather than of the note, which is why it lives here and needs
   * no column: a stand-up is fifteen minutes whoever runs it. The room shows elapsed against
   * it, because the whole value of a timebox is seeing it while you can still act on it.
   *
   * Advisory. Nothing stops a recording at the limit — a meeting that ends mid-sentence
   * because a timer said so would be worse than one that overran.
   */
  timeboxMinutes: number;
  /**
   * A block repeated once per attendee, with `{name}` substituted.
   *
   * A stand-up is not one conversation, it is several short ones, and a note with no place for
   * each person collapses into a paragraph nobody can find themselves in. The agenda cannot
   * express this — an agenda item is a topic, and here the topic is a person — so the body
   * carries the structure instead.
   *
   * Only the ceremonies that go round the table have one. Filled in when the note is created,
   * from the attendees it is created with, and after that it is text like any other.
   */
  perAttendee?: string;
  /**
   * How forward the meeting agent should be here, before anybody adjusts it.
   *
   * A property of the ceremony, like the timebox, and for the same reason: a stand-up and a
   * client kick-off want genuinely different agents. Fifteen minutes of "yesterday I, today
   * I" does not want a note-taker writing prose about it, and a kick-off is the one meeting
   * where missing a commitment costs most.
   *
   * Partial — a template says only what it has an opinion about, and the rest comes from
   * DEFAULT_EAGERNESS. Stating all three everywhere would make the defaults impossible to
   * change in one place, which is most of what a default is for.
   */
  eagerness?: Partial<Eagerness>;
}

/**
 * The letterhead every template opens with.
 *
 * A note is the one document here that leaves the building — mailed round after a client
 * meeting, printed, filed against an engagement — and it left looking like a screenshot of an
 * internal tool. So the mark is in the body itself rather than in the page around it: the
 * body is what gets exported, and chrome is not.
 *
 * An image and a rule, nothing else. The ceremony and the date are already on the note as
 * fields and repeating them here would be two things to keep in step, one of which is text
 * nobody updates. A root-relative path, because it is a static asset of the web app rather
 * than an upload, and `plainText` in the note list strips image syntax to nothing — so this
 * does not make an untouched note look written.
 */
const LETTERHEAD = ['![Finsera](/finsera-logo.png)', '', '---', ''];

/** A template body: the letterhead, then the ceremony's own skeleton. */
const sheet = (...lines: string[]) => [...LETTERHEAD, ...lines].join('\n');

export const TEMPLATES = {
  client_check_in: {
    label: 'Client check-in',
    description: 'A recurring conversation about how the work is going.',
    timeboxMinutes: 30,
    // A client is in the room: the agent writes freely and stays out of the conversation.
    eagerness: { notes: 'eager', speech: 'reserved' },
    agenda: [
      'What we said we would do last time',
      'How the current work is landing',
      'Blockers on their side',
      'What is next',
      'Anything commercial',
    ],
    /*
     * Opens on the last meeting's promises.
     *
     * A recurring check-in has one failure mode, and it is starting fresh every fortnight:
     * the thing agreed three weeks ago is never mentioned again by either side. Putting
     * "promised / delivered" first makes the first two minutes about the record.
     */
    body: sheet(
      '## Since last time',
      '',
      '| What we promised | Where it stands |',
      '| --- | --- |',
      '|  |  |',
      '',
      '## How the work is landing',
      '',
      '## Their side',
      '- Blockers: ',
      '- Changes their end: ',
      '- People we need: ',
      '',
      '## What is next',
      '',
      '| What | Who | When |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
      '## Commercial',
      '- Scope: ',
      '- Budget: ',
      '- Renewal: ',
      '',
      '## Decisions',
      '',
    ),
  },
  kick_off: {
    label: 'Project kick-off',
    description: 'Starting a piece of work: scope, people, and how it will run.',
    timeboxMinutes: 60,
    /*
     * The one meeting where a missed commitment is expensive.
     *
     * Everything agreed here is what the project is later held to, and nobody has the shared
     * memory yet to notice something was dropped. Worth the false positives.
     */
    eagerness: { notes: 'eager', actions: 'eager' },
    agenda: [
      'Why this project exists',
      'What are we actually delivering',
      'What we are not delivering',
      'Who does what',
      'How we will work together',
      'Data and access we need',
      'Dates and milestones',
      'Risks and unknowns',
    ],
    /*
     * The longest body of the seven, and the one meeting where that is right.
     *
     * Everything here is what the project is later held to, and a kick-off is the only hour
     * in which asking "who actually decides" is free. The two headings that look like
     * padding — what is out of scope, and who owns the access we need — are the two that
     * every overrun since has traced back to.
     */
    body: sheet(
      '## Why this project exists',
      '- Outcome wanted: ',
      '- Measure of success: ',
      '',
      '## Scope as agreed',
      '',
      '| In scope | Out of scope |',
      '| --- | --- |',
      '|  |  |',
      '',
      '## People and roles',
      '',
      '| Name | Role | Decides on |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
      '## How we work together',
      '- Ceremonies: ',
      '- Reporting: ',
      '- Where things live: ',
      '',
      '## Access needed',
      '',
      '| System | Data we need | Owner | Asked on |',
      '| --- | --- | --- | --- |',
      '|  |  |  |  |',
      '',
      '## Dates',
      '',
      '| Milestone | Date | Fixed |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
      '## Risks',
      '',
      '| Risk | If it happens | What we do about it |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
      '## Decisions',
      '',
    ),
  },
  discovery: {
    label: 'Discovery / intake',
    description: 'A first conversation with a prospect or about a new problem.',
    timeboxMinutes: 60,
    // The whole point is to hear things nobody thought to ask about; record generously.
    eagerness: { notes: 'eager' },
    agenda: [
      'What problem are they trying to solve',
      'How it is handled today',
      'What they have tried',
      'Where the data lives',
      'Who decides',
      'Budget and timing',
      'Whether we are a fit',
    ],
    /*
     * `## Fit` is the heading a discovery note usually lacks and always needs.
     *
     * A first conversation that only records what the prospect wants produces a note that
     * reads as a yes. The reasons to walk away are known in the room and forgotten by the
     * time anybody writes a proposal, so there is somewhere to put them.
     */
    body: sheet(
      '## The problem in their words',
      '',
      '## Current situation',
      '- Done today by: ',
      '- What it costs them: ',
      '- Already tried: ',
      '',
      '## Data landscape',
      '',
      '| System | What is in it | Who owns it | Any good |',
      '| --- | --- | --- | --- |',
      '|  |  |  |  |',
      '',
      '## Decision process',
      '- Decides: ',
      '- Also involved: ',
      '- Budget: ',
      '- Timing: ',
      '',
      '## Fit',
      '- Why us: ',
      '- Reasons to say no: ',
      '',
    ),
  },
  /*
   * The SCRUM ceremonies.
   *
   * Absent until now, which was a strange gap in a platform whose stated core is keeping
   * track of SCRUM: you could record a client check-in or a kick-off but not a stand-up.
   * Timeboxes are the conventional ones, and they are the reason the room can show elapsed
   * against something — fifteen minutes is the whole point of a stand-up.
   */
  daily_standup: {
    label: 'Daily stand-up',
    description: 'Fifteen minutes, round the table, blockers first.',
    timeboxMinutes: 15,
    /*
     * Fifteen minutes of round-the-table, and the note is a grid with a block per person.
     * A note-taker writing prose alongside that is producing a second, worse copy of it —
     * and the blockers, which are the only part worth catching, are usually said as actions.
     */
    eagerness: { notes: 'reserved', actions: 'balanced' },
    agenda: ['Round the table', 'Blockers', 'Anything that changes the sprint goal'],
    body: sheet('## Sprint goal', '', '## Round the table', '', '## Blockers', '', '## Decisions', ''),
    perAttendee: ['### {name}', '', '- Yesterday: ', '- Today: ', '- Blockers: ', ''].join('\n'),
  },
  sprint_planning: {
    label: 'Sprint planning',
    description: 'Agreeing what the next sprint is for and what fits in it.',
    timeboxMinutes: 60,
    agenda: [
      'What is the goal',
      'Capacity and dates',
      'What comes in',
      'What we are deliberately not doing',
      'What we depend on',
      'Risks',
    ],
    /*
     * Capacity above the list of work, not below it.
     *
     * It was underneath, which is the order in which a sprint gets over-committed: by the
     * time anybody counts the working days the board is already full and the count becomes
     * a thing to argue with rather than a thing to plan against.
     */
    body: sheet(
      '## Goal',
      '',
      '## Capacity',
      '- Dates: ',
      '- Working days: ',
      '- Away: ',
      '',
      '## Coming in',
      '',
      '| Item | Why now | Size | Owner |',
      '| --- | --- | --- | --- |',
      '|  |  |  |  |',
      '',
      '## Left out, on purpose',
      '',
      '## Depends on',
      '',
      '| What we need | Who from | By when |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
      '## Risks',
      '',
      '## Decisions',
      '',
    ),
  },
  sprint_review: {
    label: 'Sprint review',
    description: 'Showing what was finished and hearing what people make of it.',
    timeboxMinutes: 45,
    agenda: [
      'What we finished',
      'What we did not, and why',
      'What we showed',
      'Feedback',
      'What that changes',
    ],
    /*
     * `## Finished` and `## Not finished` arrive filled in — see `reviewBody`. The headings
     * below them are the parts of a review a board cannot know: what was actually
     * demonstrated, what people made of it, and what the next sprint therefore looks like.
     */
    body: sheet(
      '## Finished',
      '',
      '## Not finished',
      '',
      '## What we showed',
      '',
      '## Feedback',
      '',
      '| From | What they said | What we do about it |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
      '## What changes',
      '',
      '## Decisions',
      '',
    ),
  },
  retrospective: {
    label: 'Retrospective',
    description: 'Looking back at a period of work.',
    timeboxMinutes: 45,
    agenda: [
      'How the last actions went',
      'What went well',
      'What did not',
      'What we still do not understand',
      'What we change next',
    ],
    /*
     * `## Puzzles` is not padding.
     *
     * "Went well" and "did not go well" both ask for a verdict, and the most useful thing a
     * team notices in a sprint is usually neither — it is something odd that nobody has
     * explained yet. Without somewhere to put it, it gets forced into one of the two columns
     * as a complaint and stops being a question.
     *
     * `## Changing` keeps its name: `retroBody` holds the last retro's promises to account
     * above it, and a retro whose actions have no owner and no date is the reason it had to.
     */
    body: sheet(
      '## Went well',
      '',
      '## Did not go well',
      '',
      '## Puzzles',
      '',
      '## Changing',
      '',
      '| What we change | Owner | By when |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
    ),
  },
} satisfies Record<string, Template>;

export type TemplateName = keyof typeof TEMPLATES;

export const TEMPLATE_LIST = Object.entries(TEMPLATES).map(([name, t]) => ({
  name,
  label: t.label,
  description: t.description,
  agenda: t.agenda,
  timeboxMinutes: t.timeboxMinutes,
}));

/**
 * The body a template starts a note with, with a block per person where it has one.
 *
 * Pure, so the shape of a stand-up note is testable without a database.
 */
export function bodyFor(template: Template, attendees: Array<{ name: string }> = []): string {
  if (!template.perAttendee || attendees.length === 0) return template.body;
  const blocks = attendees.map((a) => template.perAttendee!.replace(/\{name\}/g, a.name));
  return [template.body.trimEnd(), '', ...blocks].join('\n');
}

/**
 * What the board knows on the morning of a stand-up.
 *
 * Declared here rather than imported from scrum, so meetings owns the shape it renders and the
 * dependency stays one way. Scrum fills it in; this file never asks scrum anything.
 */
export interface BoardDigest {
  /** The running sprint's goal, verbatim. */
  sprintGoal: string | null;
  /** Per person: what they moved since the last stand-up, and what they have in flight. */
  people: Array<{ name: string; moved: string[]; doing: string[] }>;
  blocked: Array<{ title: string; reason: string; days: number }>;
}

/**
 * Insert a block just below the letterhead, above the ceremony's first heading.
 *
 * The two ceremonies that open with something the board already knows — what the last retro
 * promised, what the sprint contained — used to build that by prepending to the body. That
 * put it above the mark, so the one document that leaves the building started with a
 * paragraph and had its letterhead buried three lines down.
 *
 * Falls back to prepending when there is no rule to find, so a body assembled some other way
 * is never silently dropped on the floor.
 */
function belowLetterhead(body: string, block: string): string {
  const lines = body.split('\n');
  const rule = lines.findIndex((l) => l.trim() === '---');
  if (rule === -1) return [block, '', body].join('\n');
  lines.splice(rule + 1, 0, '', block);
  return lines.join('\n');
}

/** Insert content directly under a heading, leaving the template's own structure alone. */
function under(body: string, heading: string, content: string): string {
  const lines = body.split('\n');
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at === -1) return body;
  lines.splice(at + 1, 0, '', content);
  return lines.join('\n');
}

/**
 * A stand-up note that already knows what happened.
 *
 * The headings this fills were seeded empty and stayed empty — three stand-ups were held and
 * every body was still `## Round the table` with nothing under it. That is not laziness: the
 * board already knew what moved, who is stuck and for how long, so the note was asking for a
 * transcription rather than for anything new. It now arrives with the transcription done and
 * only the parts a person has to supply — today's intent, and the decisions — left blank.
 *
 * A separate function rather than a branch inside `bodyFor`, which stays byte-identical: that
 * one is the answer to "what does this template start as", which is still a real question with
 * a different answer.
 *
 * Pure. The digest is passed in, so the shape of a stand-up is testable without a database.
 */
export function standupBody(
  template: Template,
  attendees: Array<{ name: string }>,
  digest: BoardDigest,
): string {
  const list = (items: string[]) => items.map((t) => `  - ${t}`).join('\n');
  const key = (name: string) => name.trim().toLowerCase();

  /*
   * Everyone in the room, plus anyone the board saw move something.
   *
   * Attendees alone would silently drop a colleague who worked yesterday and has not been
   * added to today's note — the board knew, and the round-the-table would not have said so.
   * Matching is by name because that is all an attendee has; normalised, so a stray capital
   * does not produce two blocks for one person.
   */
  const names = [...attendees.map((a) => a.name)];
  for (const p of digest.people) {
    if (!names.some((n) => key(n) === key(p.name))) names.push(p.name);
  }

  const blocks = names.map((name) => {
    const person = digest.people.find((p) => key(p.name) === key(name));
    const moved = person?.moved ?? [];
    const doing = person?.doing ?? [];
    return [
      `### ${name}`,
      '',
      // Filled from what they actually moved; "Today" stays blank because it is the one
      // thing the board cannot know and the only thing a stand-up is really for.
      moved.length > 0 ? `- Yesterday:\n${list(moved)}` : '- Yesterday: ',
      '- Today: ',
      doing.length > 0 ? `- In flight:\n${list(doing)}` : '- In flight: nothing',
      '',
    ].join('\n');
  });

  let body = template.body;
  if (digest.sprintGoal) body = under(body, '## Sprint goal', digest.sprintGoal);
  if (blocks.length > 0) body = under(body, '## Round the table', blocks.join('\n'));
  body = under(
    body,
    '## Blockers',
    digest.blocked.length > 0
      ? digest.blocked
          .map((b) => `- **${b.title}** — ${b.reason} _(${b.days}d)_`)
          .join('\n')
      : '_Nothing is recorded as blocked._',
  );
  return body;
}

/** What a sprint contained, for the review that discusses it. Filled in by scrum. */
export interface ReviewDigest {
  name: string;
  goal: string | null;
  finished: string[];
  unfinished: string[];
  /** What this board says "done" means. Copied in so the ceremony reads it. */
  definitionOfDone: string | null;
}

/**
 * A commitment from an earlier meeting on this work that is not finished.
 *
 * Two things wear the same face here and the difference is the whole point. An `undecided` one
 * was said out loud and never accepted or dismissed — it exists only on a note and no screen has
 * ever counted it. An `undone` one was accepted, is a card on the board, and simply has not been
 * done. The first needs a decision; the second needs doing, and duplicating it would put the
 * same work on the board twice.
 *
 * Declared here rather than in the service, for the same reason the digests are: this file owns
 * the shape it renders.
 */
export interface Commitment {
  /** The action point it came from — the ancestor, when this is carried forward. */
  id: string;
  text: string;
  assigneeId: string | null;
  dueOn: string | null;
  noteId: string;
  noteTitle: string;
  meetingDate: string;
  state: 'undecided' | 'undone';
  /** The card it became, when it was accepted. Null while it is still undecided. */
  taskId: string | null;
}

/** What the last retrospective promised, and whether it happened. */
export interface RetroDigest {
  actions: Array<{ title: string; done: boolean }>;
}

/**
 * A sprint review that opens on what actually happened.
 *
 * `## Finished` and `## Not finished` are the two lists the board has had all along, and the
 * review asked somebody to read them off a screen and type them in again. Feedback and what it
 * changes stay blank, because those are the parts a review is for.
 */
export function reviewBody(template: Template, digest: ReviewDigest): string {
  const list = (items: string[], empty: string) =>
    items.length > 0 ? items.map((t) => `- ${t}`).join('\n') : `_${empty}_`;

  let body = template.body;
  body = under(body, '## Finished', list(digest.finished, 'Nothing was finished.'));
  body = under(
    body,
    '## Not finished',
    list(digest.unfinished, 'Everything that was taken on landed.'),
  );
  /*
   * The definition of done, at the top of the meeting that decides what is done.
   *
   * Written where the board is configured and read nowhere, which is the usual fate of a
   * definition of done. Copying it here is the whole enforcement mechanism, and deliberately
   * so — a checklist that gates a move is the workflow automation the charter rules out.
   */
  const preamble = [
    digest.goal ? `_Sprint goal: ${digest.goal}_` : null,
    digest.definitionOfDone ? `> **Done means:** ${digest.definitionOfDone}` : null,
  ].filter(Boolean);
  return preamble.length > 0 ? belowLetterhead(body, preamble.join('\n\n')) : body;
}

/**
 * A retrospective that starts by holding the last one to account.
 *
 * The single most valuable habit in SCRUM and the one this platform could not support: retro
 * actions became ordinary backlog cards, indistinguishable from work, so the next retro had no
 * way to ask whether any of them happened. A retro that cannot ask that is a conversation.
 */
export function retroBody(template: Template, digest: RetroDigest): string {
  if (digest.actions.length === 0) return template.body;
  const lines = digest.actions.map((a) => `- [${a.done ? 'x' : ' '}] ${a.title}`);
  return belowLetterhead(
    template.body,
    ['## Last time we said we would', '', ...lines].join('\n'),
  );
}


/**
 * A note that opens with what is still owed on this work.
 *
 * Every meeting started from zero. A commitment made a fortnight ago appeared nowhere in the
 * next conversation about the same project, so both sides forgot it and the record was the only
 * thing that remembered — which is the failure a recurring meeting exists to prevent.
 *
 * Below the letterhead like the retro block, so the one document that leaves the building still
 * opens with the mark rather than with a list.
 *
 * Unless the ceremony already asks the question, in which case this fills in the section it
 * already has. A client check-in opens on `## Since last time` and a table of what was promised
 * — the hand-written version of exactly this — and adding a second heading of the same name
 * would leave the note with two, which is not merely untidy: a section here is addressed by its
 * heading TEXT (`sectionRange`), so a duplicate makes the agent's writes ambiguous about which
 * of them they mean.
 *
 * Unticked boxes, deliberately. A commitment that is still owed is not a heading to read past;
 * it is something with two possible answers, and a box that can be ticked in the room asks the
 * question in the only place anybody will answer it.
 *
 * Pure, and a no-op on an empty ledger: a first meeting looks exactly as it did before.
 */
/**
 * The heading the ledger lives under.
 *
 * Shared with `client_check_in`, whose body already opens with it — see `carriedBody`.
 */
const CARRIED_HEADING = '## Since last time';

export function carriedBody(body: string, commitments: Commitment[]): string {
  if (commitments.length === 0) return body;
  const lines = commitments.map((c) => {
    /*
     * What it is waiting on, said plainly.
     *
     * "on the board, not finished" and "never decided" are different problems with different
     * answers, and a list that renders them identically turns the second into the first — it
     * reads as though somebody is already on it.
     */
    const where =
      c.state === 'undone' ? 'on the board, not finished' : 'never accepted or dismissed';
    const due = c.dueOn ? `, due ${c.dueOn}` : '';
    return `- [ ] ${c.text} _(${where} — "${c.noteTitle}", ${c.meetingDate}${due})_`;
  });
  const block = lines.join('\n');
  return body.split('\n').some((l) => l.trim() === CARRIED_HEADING)
    ? under(body, CARRIED_HEADING, block)
    : belowLetterhead(body, [CARRIED_HEADING, '', block].join('\n'));
}
