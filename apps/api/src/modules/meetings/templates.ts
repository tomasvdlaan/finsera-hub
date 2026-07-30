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
