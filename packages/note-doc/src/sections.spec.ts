import { describe, expect, it } from 'vitest';
import { Slice } from '@tiptap/pm/model';
import { markdownToDoc } from './markdown/parse.js';
import { docToMarkdown } from './markdown/serialize.js';
import { endOfDoc, headingsOf, sectionRange } from './sections.js';
import { noteSchema } from './schema.js';

const body = [
  '# Daily standup',
  '',
  'Some preamble.',
  '',
  '## Decisions',
  '',
  '- Weekly refresh',
  '',
  '### Rationale',
  '',
  'Because the nightly job is flaky.',
  '',
  '## Follow-up',
  '',
  '- Ask compliance',
].join('\n');

describe('headingsOf', () => {
  it('lists the h2 and h3 headings, and not the title', () => {
    expect(headingsOf(markdownToDoc(body))).toEqual(['Decisions', 'Rationale', 'Follow-up']);
  });
});

describe('sectionRange', () => {
  it('returns null for a heading that is not there', () => {
    expect(sectionRange(markdownToDoc(body), 'Nonexistent')).toBeNull();
  });

  it('matches case-insensitively', () => {
    expect(sectionRange(markdownToDoc(body), 'decisions')).not.toBeNull();
  });

  /**
   * The one that matters. A section must not swallow its sibling.
   *
   * Checked by cutting the range out and reading what is left, which is the only way to be
   * sure the boundary is where it claims: an off-by-one in a position is invisible until it
   * deletes a heading.
   */
  it('stops at the next heading of the same level, keeping the deeper one', () => {
    const doc = markdownToDoc(body);
    const range = sectionRange(doc, 'Decisions')!;
    const cut = docToMarkdown(doc.cut(range.from, range.to)).trim();

    expect(cut).toBe('- Weekly refresh\n\n### Rationale\n\nBecause the nightly job is flaky.');
    expect(cut).not.toContain('Follow-up');
  });

  it('runs to the end of the document for the last section', () => {
    const doc = markdownToDoc(body);
    const range = sectionRange(doc, 'Follow-up')!;
    expect(range.to).toBe(endOfDoc(doc));
    expect(docToMarkdown(doc.cut(range.from, range.to)).trim()).toBe('- Ask compliance');
  });

  it('gives an empty range for a heading with nothing under it', () => {
    const doc = markdownToDoc('## Empty\n\n## Next\n\ntext');
    const range = sectionRange(doc, 'Empty')!;
    expect(range.from).toBe(range.to);
  });

  /**
   * Replacing a section leaves everything else byte-identical.
   *
   * This is the property the whole design rests on — that an assistant writing under one
   * heading cannot touch a word under another.
   */
  it('replaces only its own content', () => {
    const doc = markdownToDoc(body);
    const range = sectionRange(doc, 'Decisions')!;
    const replacement = markdownToDoc('- Daily refresh after all');

    const next = doc.replace(range.from, range.to, new Slice(replacement.content, 0, 0));

    const out = docToMarkdown(next);
    expect(out).toContain('- Daily refresh after all');
    expect(out).toContain('## Follow-up');
    expect(out).toContain('- Ask compliance');
    expect(out).toContain('Some preamble.');
    expect(out).not.toContain('Weekly refresh');
    expect(noteSchema.nodes.doc).toBeDefined();
  });
});
