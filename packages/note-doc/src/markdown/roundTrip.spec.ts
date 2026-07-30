import { describe, expect, it } from 'vitest';
import { noteSchema } from '../schema.js';
import { markdownToDoc } from './parse.js';
import { docToMarkdown } from './serialize.js';

/**
 * Markdown in, the same Markdown out.
 *
 * This is the load-bearing test of the whole package. The note body is Markdown because a
 * model can read and rewrite it; that argument only holds if the editor gives the text back
 * unchanged. Every failure here is silent in production — formatting does not error, it
 * disappears, and the author finds out when they reload a note and a paragraph has lost its
 * bold.
 *
 * It also runs without jsdom, which is the point of the rewrite: the same functions run on
 * the server, so what the AI writes and what a person types go through one implementation.
 */
const roundTrip = (markdown: string) => docToMarkdown(markdownToDoc(markdown)).trim();

describe('the Markdown round trip', () => {
  const stable: Array<[string, string]> = [
    ['a paragraph', 'Just some text.'],
    ['bold', 'A **bold** word.'],
    ['italic', 'An *italic* word.'],
    ['strikethrough', 'A ~~struck~~ word.'],
    ['highlight', 'A ==highlighted== word.'],
    ['inline code', 'Run `pnpm test` first.'],
    ['a link', 'See [the policy](https://example.com/policy).'],
    ['headings', '# One\n\n## Two\n\n### Three'],
    ['a bullet list', '- first\n- second'],
    ['a nested bullet list', '- first\n  - nested\n- second'],
    ['an ordered list', '1. first\n2. second'],
    ['a blockquote', '> Quoted text.'],
    ['a fenced code block', '```ts\nconst a = 1;\n```'],
    ['a plain fenced block', '```\nplain\n```'],
    ['a horizontal rule', 'Above\n\n---\n\nBelow'],
    ['an image', '![a chart](https://example.com/chart.png)'],
    ['an unchecked task', '- [ ] write it down'],
    ['a checked task', '- [x] written down'],
    ['several tasks', '- [ ] first\n- [x] second'],
    ['a table', '| a | b |\n| --- | --- |\n| c | d |'],
    ['marks inside a list', '- a **bold** item\n- a `code` item'],
    ['a link inside a heading', '## See [this](https://example.com)'],
    ['nested emphasis', 'A ***bold italic*** word.'],
  ];

  for (const [name, markdown] of stable) {
    it(`leaves ${name} untouched`, () => {
      expect(roundTrip(markdown)).toBe(markdown);
    });
  }

  /*
   * The cases where the text changes but the meaning does not. Written down deliberately:
   * an unlisted normalisation is indistinguishable from a bug the next time somebody reads a
   * diff of a note body.
   */
  it('normalises bullet markers to a dash', () => {
    expect(roundTrip('* starred\n* items')).toBe('- starred\n- items');
  });

  it('keeps the starting number of an ordered list', () => {
    expect(roundTrip('3. third\n4. fourth')).toBe('3. third\n4. fourth');
  });

  it('leaves a mixed checkbox list as literal text rather than guessing', () => {
    // Converting the plain item to an unchecked task would assert something nobody wrote.
    // The brackets come back escaped, which is ugly but stable: it parses to the same text.
    expect(roundTrip('- [ ] a task\n- not a task')).toBe('- \\[ \\] a task\n- not a task');
  });

  it('treats HTML as text', () => {
    expect(roundTrip('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('the blockquote corruption that Markdown cannot express', () => {
  /*
   * Reproducible only from node state, never from parsed Markdown — which is exactly why it
   * survived so long. Building the document by hand is the only way to reach it.
   */
  it('does not double the next mark after an empty first paragraph', () => {
    const doc = noteSchema.node('doc', null, [
      noteSchema.node('blockquote', null, [
        noteSchema.node('paragraph'),
        noteSchema.node('paragraph', null, [
          noteSchema.text('Decision:', [noteSchema.marks.bold!.create()]),
          noteSchema.text(' Weekly refresh'),
        ]),
      ]),
    ]);

    const markdown = docToMarkdown(doc).trim();
    expect(markdown).toBe('> **Decision:** Weekly refresh');
    // And it survives being read back, which the doubled form did not.
    expect(roundTrip(markdown)).toBe('> **Decision:** Weekly refresh');
  });

  it('still writes a line for a quote that holds only blank paragraphs', () => {
    const doc = noteSchema.node('doc', null, [
      noteSchema.node('blockquote', null, [noteSchema.node('paragraph')]),
    ]);
    expect(docToMarkdown(doc).trim()).toBe('>');
  });
});

describe('colour', () => {
  /*
   * Markdown has no colour, so it travels as the HTML tag every editor uses for it. These
   * are the only two tags this parser will look at, and the point of the tests is as much
   * what is refused as what is kept.
   */
  it('round-trips coloured text', () => {
    const md = 'The <span style="color:#d33">retention period</span> is seven years.';
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips a coloured highlight', () => {
    const md = 'Watch <mark style="background-color:#ffd400">this number</mark> closely.';
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps a plain highlight as Markdown rather than a tag', () => {
    // The common case must stay readable in any other tool.
    expect(roundTrip('A ==highlighted== word.')).toBe('A ==highlighted== word.');
  });

  it('keeps other formatting inside a colour', () => {
    const md = 'A <span style="color:#0a0">**bold green**</span> word.';
    expect(roundTrip(md)).toBe(md);
  });

  it('normalises the colour to lower case', () => {
    expect(roundTrip('<span style="color:#D33">red</span>')).toBe('<span style="color:#d33">red</span>');
  });

  it('refuses a colour that is not a hex literal', () => {
    // `red` is a perfectly good CSS colour and is still refused: one closed shape is what
    // makes this safe to accept at all.
    const md = '<span style="color:red">nope</span>';
    expect(roundTrip(md)).toBe('<span style="color:red">nope</span>');
    expect(markdownToDoc(md).firstChild!.firstChild!.marks).toHaveLength(0);
  });

  it('refuses anything smuggled alongside the colour', () => {
    for (const attack of [
      '<span style="color:#d33" onclick="steal()">x</span>',
      '<span style="color:#d33;background:url(http://evil)">x</span>',
      '<span class="x" style="color:#d33">x</span>',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
    ]) {
      const doc = markdownToDoc(attack);
      // Nothing is marked and nothing becomes a node: it is all just text on the page.
      expect(doc.textContent).toContain('<');
      expect(doc.firstChild!.firstChild!.marks).toHaveLength(0);
    }
  });

  it('leaves a stray closing tag as prose', () => {
    expect(roundTrip('He wrote </span> on the whiteboard.')).toContain('</span>');
  });
});

describe('tables', () => {
  it('escapes a pipe inside a cell', () => {
    const markdown = '| a | b |\n| --- | --- |\n| c \\| d | e |';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('keeps marks inside cells', () => {
    const markdown = '| **bold** | *italic* |\n| --- | --- |\n| c | d |';
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe('the document is always valid', () => {
  it('gives an empty string a paragraph rather than an empty doc', () => {
    const doc = markdownToDoc('');
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe('paragraph');
    // An empty `doc` fails schema validation, and it is what a brand new note starts as.
    expect(() => doc.check()).not.toThrow();
  });

  it('produces a document that checks out for every stable case', () => {
    for (const [, markdown] of stableCases()) {
      expect(() => markdownToDoc(markdown).check()).not.toThrow();
    }
  });
});

function stableCases(): Array<[string, string]> {
  return [
    ['bold', 'A **bold** word.'],
    ['table', '| a | b |\n| --- | --- |\n| c | d |'],
    ['tasks', '- [ ] first\n- [x] second'],
    ['nested list', '- first\n  - nested\n- second'],
    ['code', '```ts\nconst a = 1;\n```'],
  ];
}
