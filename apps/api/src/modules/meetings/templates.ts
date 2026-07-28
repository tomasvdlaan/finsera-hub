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
}

export const TEMPLATES = {
  client_check_in: {
    label: 'Client check-in',
    description: 'A recurring conversation about how the work is going.',
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
  retrospective: {
    label: 'Retrospective',
    description: 'Looking back at a period of work.',
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
}));
