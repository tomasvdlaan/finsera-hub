/**
 * Meeting templates.
 *
 * A template is an agenda plus a skeleton body, nothing cleverer. They exist because the
 * hardest part of taking notes is starting, and because 6c needs an agenda to detect a
 * meeting drifting away from what it was for.
 *
 * Deliberately few. A template nobody uses is worse than no template — it becomes a menu
 * to read past every time.
 */
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
}

export const TEMPLATES = {
  client_check_in: {
    label: 'Client check-in',
    description: 'A recurring conversation about how the work is going.',
    timeboxMinutes: 30,
    agenda: ['How is the current work landing?', 'Blockers on their side', 'What is next', 'Anything commercial'],
    body: [
      '## Context',
      '',
      '## Discussion',
      '',
      '## Decisions',
      '',
      '## Follow-up',
      '',
    ].join('\n'),
  },
  kick_off: {
    label: 'Project kick-off',
    description: 'Starting a piece of work: scope, people, and how it will run.',
    timeboxMinutes: 60,
    agenda: [
      'What are we actually delivering',
      'Who does what',
      'Data and access we need',
      'How we report progress',
      'Risks and unknowns',
    ],
    body: [
      '## Scope as agreed',
      '',
      '## People and roles',
      '',
      '## Access needed',
      '',
      '## Risks',
      '',
      '## Decisions',
      '',
    ].join('\n'),
  },
  discovery: {
    label: 'Discovery / intake',
    description: 'A first conversation with a prospect or about a new problem.',
    timeboxMinutes: 60,
    agenda: [
      'What problem are they trying to solve',
      'What they have tried',
      'Where the data lives',
      'Who decides',
      'Budget and timing',
    ],
    body: [
      '## The problem in their words',
      '',
      '## Current situation',
      '',
      '## Data landscape',
      '',
      '## Decision process',
      '',
      '## Next step',
      '',
    ].join('\n'),
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
    agenda: ['Round the table', 'Blockers', 'Anything that changes the sprint goal'],
    body: ['## Sprint goal', '', '## Round the table', '', '## Blockers', '', '## Decisions', ''].join('\n'),
    perAttendee: ['### {name}', '', '- Yesterday: ', '- Today: ', '- Blockers: ', ''].join('\n'),
  },
  sprint_planning: {
    label: 'Sprint planning',
    description: 'Agreeing what the next sprint is for and what fits in it.',
    timeboxMinutes: 60,
    agenda: [
      'What is the goal',
      'What comes in',
      'Capacity and dates',
      'What we are deliberately not doing',
      'Risks',
    ],
    body: [
      '## Goal',
      '',
      '## Coming in',
      '',
      '## Left out, on purpose',
      '',
      '## Capacity',
      '',
      '## Risks',
      '',
    ].join('\n'),
  },
  sprint_review: {
    label: 'Sprint review',
    description: 'Showing what was finished and hearing what people make of it.',
    timeboxMinutes: 45,
    agenda: ['What we finished', 'What we did not, and why', 'Feedback', 'What that changes'],
    body: [
      '## Finished',
      '',
      '## Not finished',
      '',
      '## Feedback',
      '',
      '## What changes',
      '',
    ].join('\n'),
  },
  retrospective: {
    label: 'Retrospective',
    description: 'Looking back at a period of work.',
    timeboxMinutes: 45,
    agenda: ['What went well', 'What did not', 'What we change next'],
    body: ['## Went well', '', '## Did not go well', '', '## Changing', ''].join('\n'),
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
  return digest.goal ? `_Sprint goal: ${digest.goal}_\n\n${body}` : body;
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
  return [
    '## Last time we said we would',
    '',
    ...lines,
    '',
    template.body,
  ].join('\n');
}
