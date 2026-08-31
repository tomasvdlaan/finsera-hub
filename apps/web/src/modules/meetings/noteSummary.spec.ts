import { describe, expect, it } from 'vitest';
import { saidSomething } from './noteSummary.js';

/**
 * Whether a note has been written in, as the list has to decide it.
 *
 * The templates are seeded skeletons, so almost every line of a fresh note is scaffolding the
 * author did not type: headings, a letterhead, empty labels, and — since the templates grew
 * tables — a header row, a `| --- |` and an empty row per table. Reporting any of those as
 * content makes every untouched meeting in the list look written, which is the one thing this
 * list is best placed to tell you and the one thing it would then get wrong.
 */
const SEEDED = [
  '![Finsera](/finsera-logo.png)',
  '',
  '---',
  '',
  '## Why this project exists',
  '- Outcome wanted: ',
  '- Measure of success: ',
  '',
  '## Risks',
  '',
  '| Risk | If it happens | What we do about it |',
  '| --- | --- | --- |',
  '|  |  |  |',
  '',
  '## Follow-up',
  '- [ ] ',
  '',
].join('\n');

describe('saidSomething', () => {
  it('reports a freshly seeded note as unwritten', () => {
    expect(saidSomething(SEEDED)).toBeNull();
  });

  it('is not fooled by the letterhead', () => {
    // plainText strips image syntax to nothing, so the mark must not read as the first words.
    expect(saidSomething('![Finsera](/finsera-logo.png)\n\n---\n')).toBeNull();
  });

  it('notices the moment somebody fills a cell in', () => {
    const written = SEEDED.replace('|  |  |  |', '| Credentials are late | Sprint 1 slips | Chase Anna |');
    expect(saidSomething(written)).toBe('Credentials are late · Sprint 1 slips · Chase Anna');
  });

  it('still reads ordinary prose', () => {
    expect(saidSomething(`${SEEDED}\nThey want it live before the audit.`)).toBe(
      'They want it live before the audit.',
    );
  });

  it('does not mistake a filled label for the label', () => {
    expect(saidSomething('## Capacity\n- Away: Anna, all week')).toBe('Away: Anna, all week');
  });
});
