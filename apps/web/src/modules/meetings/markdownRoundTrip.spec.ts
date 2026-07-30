/**
 * @vitest-environment jsdom
 *
 * tiptap-markdown's parser builds a DOM to hand ProseMirror, so this one spec needs a document.
 * Set per file rather than globally: every other test here is pure logic and runs faster
 * without one.
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { MarkdownBlockquote, MarkdownHighlight } from './markdownMark.js';
import { calloutNode, taskNode } from './slashCommands.js';

/**
 * Markdown fidelity.
 *
 * The note body round-trips through the serializer on every keystroke, so anything the
 * serializer cannot express is deleted by the next autosave — silently, in the note, with no
 * error anywhere. That has already happened twice in this editor: the Highlight button applied
 * a mark with no spec, and StarterKit's Underline was on by default and bound to Cmd+U.
 *
 * Both were found by a person noticing. This is the test that finds the next one: every mark
 * and node the editor can produce, parsed and serialised and parsed again, asserting the text
 * survives. A new extension without a Markdown spec fails here rather than in somebody's notes.
 *
 * The editor is built headless, matching RichEditor's extension list — which is the one thing
 * that has to be kept in step by hand, and the reason the list is short.
 */
const editor = () =>
  new Editor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        underline: false,
        codeBlock: false,
        blockquote: false,
        link: { openOnClick: false },
      }),
      MarkdownHighlight,
      MarkdownBlockquote,
      Image.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
  });

/** Parse Markdown in, serialise it back out. Stability under this is the whole contract. */
function roundTrip(markdown: string): string {
  const instance = editor();
  instance.commands.setContent(markdown);
  const out = (
    instance.storage as unknown as { markdown: { getMarkdown(): string } }
  ).markdown.getMarkdown();
  instance.destroy();
  return out;
}

/** Serialise a node built in code, the way a slash command inserts one. */
function serialiseNode(node: Record<string, unknown>): string {
  const instance = editor();
  instance.commands.setContent({ type: 'doc', content: [node] });
  const out = (
    instance.storage as unknown as { markdown: { getMarkdown(): string } }
  ).markdown.getMarkdown();
  instance.destroy();
  return out;
}

describe('Markdown round-trips', () => {
  const cases: Array<[string, string]> = [
    ['a heading', '## What we decided'],
    ['bold', 'We **must** ship it'],
    ['italic', 'We *might* ship it'],
    ['strike', 'We ~~will~~ ship it'],
    ['inline code', 'Run `pnpm test` first'],
    ['a link', 'See [the policy](https://example.com/policy)'],
    ['a bullet list', '- One\n- Two'],
    ['an ordered list', '1. One\n2. Two'],
    ['a task list', '- [ ] Not done\n- [x] Done'],
    ['a blockquote', '> **Decision:** Weekly refresh'],
    ['a fenced code block', '```ts\nconst x = 1;\n```'],
    ['an image', '![a chart](https://example.com/chart.png)'],
    ['a horizontal rule', 'Above\n\n---\n\nBelow'],
    // The one that was broken: applied by a toolbar button and deleted on save.
    ['a highlight', 'The ==retention period== is seven years'],
  ];

  for (const [what, markdown] of cases) {
    it(`keeps ${what}`, () => {
      const once = roundTrip(markdown);
      // Stability, not byte-equality with the input: the serializer normalises, and that is
      // fine as long as normalising again changes nothing.
      expect(roundTrip(once)).toBe(once);
      // And the words themselves must still be there.
      const words = markdown.replace(/[^a-zA-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
      for (const word of words) expect(once).toContain(word);
    });
  }

  it('carries a highlight through as a mark, not as punctuation', () => {
    const out = roundTrip('The ==retention period== is seven years');
    // Before markdownMark.ts the mark had no spec: it serialised to nothing with html:false,
    // and `==` was never parsed, so the model's own ==highlight== arrived as literal text.
    expect(out).toContain('==retention period==');
  });

  it('does not offer underline, which has no Markdown to survive as', () => {
    const instance = editor();
    // StarterKit enables it by default and binds Cmd+U. Left on, that shortcut produced text
    // that looked underlined until the next save quietly removed the mark.
    expect(instance.schema.marks.underline).toBeUndefined();
    instance.destroy();
  });

  it('serialises what the slash commands insert', () => {
    // These are built as nodes in code rather than parsed from Markdown, so they get their own
    // assertion — the note body is what the serializer makes of them.
    expect(serialiseNode(calloutNode('Decision', 'Weekly refresh instead of daily'))).toBe(
      '> **Decision:** Weekly refresh instead of daily',
    );
    expect(serialiseNode(taskNode('Send the ledger mapping'))).toContain(
      '- [ ] **Task:** Send the ledger mapping',
    );
  });

  /*
   * The bug this file was written to catch, in the shape that actually reproduced it.
   *
   * Parsing that Markdown does not produce it — the parser drops blank quoted lines. It comes
   * from the editor's own state, which is why these build the nodes directly: an empty
   * paragraph FIRST inside a quote serialised to '> \n> ****Decision:**'. Last was always fine.
   * Reachable by putting the caret before quoted text and pressing Enter.
   */
  const quoteWith = (children: Array<Record<string, unknown>>) => ({
    type: 'blockquote',
    content: children,
  });
  const decision = {
    type: 'paragraph',
    content: [
      { type: 'text', marks: [{ type: 'bold' }], text: 'Decision: ' },
      { type: 'text', text: 'Weekly refresh' },
    ],
  };

  it('does not corrupt a quote whose first paragraph is empty', () => {
    const out = serialiseNode(quoteWith([{ type: 'paragraph' }, decision]));
    expect(out).not.toContain('****');
    expect(out).toContain('**Decision:**');
    expect(roundTrip(out)).toBe(out);
  });

  it('is unchanged for a quote whose last paragraph is empty', () => {
    const out = serialiseNode(quoteWith([decision, { type: 'paragraph' }]));
    expect(out).toBe('> **Decision:** Weekly refresh');
  });

  it('still writes a quote that holds nothing but a blank line', () => {
    // Emitting a prefix with no content swallows whatever follows the quote.
    const out = serialiseNode(quoteWith([{ type: 'paragraph' }]));
    expect(roundTrip(out)).toBe(out);
  });
});
