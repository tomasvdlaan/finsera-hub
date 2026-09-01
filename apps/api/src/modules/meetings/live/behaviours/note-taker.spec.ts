import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '@platform/note-doc';
import {
  AI_NOTES_SECTION,
  isBlankForm,
  permitted,
  sectionMarkdownOf,
  type Op,
} from './note-taker.behaviour.js';

const op = (over: Partial<Op>): Op => ({
  op: 'replace',
  heading: 'Risks',
  markdown: 'something',
  confidence: 1,
  ...over,
});

/** A note as somebody would actually have it mid-meeting: a template, partly filled in. */
const doc = () =>
  markdownToDoc(
    [
      '## Scope as agreed',
      '',
      'Two dashboards and a monthly refresh, as discussed with Marieke.',
      '',
      '## Risks',
      '',
      `## ${AI_NOTES_SECTION}`,
      '',
      '- Budget mentioned but not agreed',
      '',
    ].join('\n'),
  );

describe('the note-taker ownership rule', () => {
  it('lets it do anything at all to its own section', () => {
    for (const kind of ['replace', 'append_to', 'clear'] as const) {
      const verdict = permitted(doc(), op({ op: kind, heading: AI_NOTES_SECTION }));
      expect(verdict).toEqual({ allowed: true, op: kind });
    }
  });

  it('lets it fill in an empty template heading', () => {
    // Filling a blank destroys nothing, which is the whole test.
    expect(permitted(doc(), op({ heading: 'Risks' }))).toEqual({ allowed: true, op: 'replace' });
  });

  it('creates a section that does not exist yet', () => {
    expect(permitted(doc(), op({ heading: 'Follow-up' }))).toEqual({
      allowed: true,
      op: 'replace',
    });
  });

  it('downgrades a replace of somebody else\'s writing to an append', () => {
    /*
     * The invariant this whole change spends, and the form it survives in. The agent's
     * judgement about what to write is usually better than its judgement about what to
     * delete, so the content is kept and the deletion is not.
     */
    expect(permitted(doc(), op({ heading: 'Scope as agreed' }))).toEqual({
      allowed: true,
      op: 'append_to',
    });
  });

  it('refuses outright to clear a section somebody wrote', () => {
    const verdict = permitted(doc(), op({ op: 'clear', heading: 'Scope as agreed', markdown: '' }));
    expect(verdict.allowed).toBe(false);
  });

  it('refuses an op with nothing in it', () => {
    expect(permitted(doc(), op({ markdown: '   ' })).allowed).toBe(false);
    expect(permitted(doc(), op({ heading: '  ' })).allowed).toBe(false);
  });

  it('refuses to clear a section that is not there', () => {
    expect(permitted(doc(), op({ op: 'clear', heading: 'Nowhere', markdown: '' })).allowed).toBe(
      false,
    );
  });
});

describe('sectionMarkdownOf', () => {
  const body = [
    '## One',
    '',
    'first',
    '',
    '### Deeper',
    '',
    'still one',
    '',
    '## Two',
    '',
    'second',
  ].join('\n');

  it('takes a section up to the next heading of the same level', () => {
    // The deeper heading belongs to the section; the sibling ends it. Getting this wrong is
    // how an append under "One" would swallow "Two".
    expect(sectionMarkdownOf(body, 'One')).toBe('first\n\n### Deeper\n\nstill one');
  });

  it('reads the last section to the end', () => {
    expect(sectionMarkdownOf(body, 'Two')).toBe('second');
  });

  it('is empty for a heading that is not there', () => {
    expect(sectionMarkdownOf(body, 'Three')).toBe('');
  });
});

/**
 * The two things that are not somebody's writing.
 *
 * The ownership rule protects text a PERSON wrote, and it could not tell that from a blank
 * form or from the agent's own last pass. So it protected those too, and the agent — allowed
 * to add but never to correct — stacked a second copy underneath instead. A real stand-up note
 * came out with the same person's "Yesterday / Today / Blockers" three deep.
 */
describe('what the agent may revise', () => {
  const standup = () =>
    markdownToDoc(
      [
        '### Tomas van der Laan',
        '',
        '- Yesterday:',
        '- Today:',
        '- Blockers:',
        '',
      ].join('\n'),
    );

  it('recognises a template block nobody has filled in', () => {
    expect(isBlankForm('- Yesterday:\n- Today:\n- Blockers:')).toBe(true);
    expect(isBlankForm('')).toBe(true);
    expect(isBlankForm('- [ ] Todo:')).toBe(true);
  });

  it('stops recognising it the moment somebody answers', () => {
    // One word after a colon and the block is an answer, and the answer is theirs.
    expect(isBlankForm('- Yesterday: reviewed the model\n- Today:')).toBe(false);
    expect(isBlankForm('- Something entirely else')).toBe(false);
  });

  it('fills in a blank form rather than appending a second one', () => {
    const verdict = permitted(standup(), op({ heading: 'Tomas van der Laan' }));
    expect(verdict).toEqual({ allowed: true, op: 'replace' });
  });

  it('lets it correct what it wrote itself last pass', () => {
    const doc = markdownToDoc('## Blockers\n\n- Waiting on credentials\n');
    const written = new Map([['blockers', '- Waiting on credentials']]);

    // Unchanged since the machine left it there, so replacing it destroys nothing.
    expect(permitted(doc, op({ heading: 'Blockers' }), written)).toEqual({
      allowed: true,
      op: 'replace',
    });
  });

  it('goes back to appending the moment a person edits it', () => {
    const doc = markdownToDoc('## Blockers\n\n- Waiting on credentials, chased Tuesday\n');
    // What the agent left is no longer what is there: somebody has been in it.
    const written = new Map([['blockers', '- Waiting on credentials']]);

    expect(permitted(doc, op({ heading: 'Blockers' }), written)).toEqual({
      allowed: true,
      op: 'append_to',
    });
  });

  it('still refuses to clear something a person wrote', () => {
    // No memory and no blank form: the original guarantee, untouched.
    const doc = markdownToDoc('## Blockers\n\n- My own note\n');
    expect(permitted(doc, op({ op: 'clear', heading: 'Blockers' }))).toEqual({
      allowed: false,
      why: 'refusing to clear a section somebody wrote',
    });
  });
});
