import { describe, expect, it } from 'vitest';
import { appendToNote, headingsOf, replaceSection } from './note-edit.js';

/**
 * Writing into a note.
 *
 * A note body has no version history, so anything these get wrong is unrecoverable and silent.
 * The cases below are the ways a section rewrite could eat text it was never asked to touch.
 */
describe('appendToNote', () => {
  it('adds to the end without touching what is there', () => {
    expect(appendToNote('## Notes\n\nSomething', 'And another thing')).toBe(
      '## Notes\n\nSomething\n\nAnd another thing\n',
    );
  });

  it('starts an empty note cleanly', () => {
    expect(appendToNote('', 'First line')).toBe('First line\n');
  });

  it('refuses to append nothing', () => {
    expect(appendToNote('## Notes', '   ')).toBe('## Notes');
  });
});

describe('replaceSection', () => {
  const note = [
    '## Context', '', 'Some background.', '',
    '## Decisions', '', 'The old decision.', '',
    '## Follow-up', '', 'A thing to do.', '',
  ].join('\n');

  it('replaces only the named section', () => {
    const out = replaceSection(note, 'Decisions', 'Weekly refresh, not daily.');
    expect(out).toContain('Weekly refresh, not daily.');
    expect(out).not.toContain('The old decision.');
    // The sections either side are the point: this is what stops it eating the meeting.
    expect(out).toContain('Some background.');
    expect(out).toContain('A thing to do.');
  });

  it('adds the section when the note has no such heading', () => {
    const out = replaceSection(note, 'Risks', 'The vendor may be late.');
    expect(out).toContain('## Risks');
    expect(out).toContain('The vendor may be late.');
    expect(out).toContain('The old decision.');
  });

  it('matches a heading whatever its case', () => {
    const out = replaceSection(note, 'decisions', 'Rewritten');
    expect(out).not.toContain('The old decision.');
    expect(out).toContain('Rewritten');
  });

  it('keeps a deeper heading inside the section it belongs to', () => {
    const nested = '## Round the table\n\n### Tomas\n\nSaid a thing.\n\n## Blockers\n\nNone.';
    const out = replaceSection(nested, 'Round the table', '### Tomas\n\nSaid a different thing.');
    // A '###' is part of the section above it; only a '##' or higher closes it.
    expect(out).toContain('Said a different thing.');
    expect(out).not.toContain('Said a thing.');
    expect(out).toContain('## Blockers');
    expect(out).toContain('None.');
  });

  it('replaces a h3 section without swallowing the h2 after it', () => {
    const nested = '## People\n\n### Anna\n\nHer update.\n\n### Tomas\n\nHis update.\n\n## Next\n\nSoon.';
    const out = replaceSection(nested, 'Anna', 'A new update.');
    expect(out).toContain('A new update.');
    expect(out).not.toContain('Her update.');
    expect(out).toContain('### Tomas');
    expect(out).toContain('His update.');
    expect(out).toContain('## Next');
  });

  it('does not match a heading by accident inside a sentence', () => {
    const body = '## Notes\n\nWe talked about decisions at length.';
    const out = replaceSection(body, 'Decisions', 'Written');
    // The word appears in prose; only a real heading counts, so this appends instead.
    expect(out).toContain('We talked about decisions at length.');
    expect(out).toContain('## Decisions');
  });
});

describe('headingsOf', () => {
  it('lists what the assistant can write into', () => {
    expect(headingsOf('# Title\n\n## Context\n\n### Tomas\n\n## Decisions')).toEqual([
      'Context',
      'Tomas',
      'Decisions',
    ]);
  });
});
