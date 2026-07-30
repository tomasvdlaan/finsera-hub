import MarkdownIt from 'markdown-it';
import markdownItMark from 'markdown-it-mark';
import { MarkdownParser } from 'prosemirror-markdown';
import { Fragment, type Node as ProsemirrorNode } from '@tiptap/pm/model';
import { noteSchema } from '../schema.js';

/**
 * Markdown in, ProseMirror out — with no DOM anywhere.
 *
 * This is the half that could not be borrowed. `tiptap-markdown` parses by turning Markdown
 * into HTML and handing it to the browser's parser, which is why the editor's round-trip test
 * needed jsdom and why the server could never have used it. markdown-it emits a token stream,
 * and prosemirror-markdown turns tokens straight into nodes, so this path runs in Node.
 *
 * `html: false` on purpose. Note bodies are partly written from meeting transcripts, which
 * the AI plan treats as untrusted input; raw HTML in a document that a model helped write is
 * a hole nobody needs. Anything that looks like a tag arrives as text.
 */
const tokenizer = MarkdownIt('default', { html: false })
  .use(markdownItMark)
  .use(wrapTableCells)
  .use(colourTags);

const parser = new MarkdownParser(noteSchema, tokenizer, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'listItem' },
  bullet_list: { block: 'bulletList' },
  ordered_list: {
    block: 'orderedList',
    // TipTap calls it `start`; markdown-it reports it as the `start` attribute, absent for 1.
    getAttrs: (tok) => ({ start: Number(tok.attrGet('start')) || 1 }),
  },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }) },
  code_block: { block: 'codeBlock', noCloseToken: true },
  fence: {
    block: 'codeBlock',
    // The info string is the fence's language: ```ts
    getAttrs: (tok) => ({ language: tok.info.trim() || null }),
    noCloseToken: true,
  },
  hr: { node: 'horizontalRule' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') || null,
      alt: tok.children?.[0]?.content ?? null,
    }),
  },
  hardbreak: { node: 'hardBreak' },

  // Tables. `thead` and `tbody` are dropped because the editor has no node for either — a
  // row knows whether it holds header cells from the cells themselves.
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'tableRow' },
  th: { block: 'tableHeader' },
  td: { block: 'tableCell' },

  // The two colour carriers. Emitted only by `colourTags`, which accepts nothing else.
  colouredText: { mark: 'textStyle', getAttrs: (tok) => ({ color: tok.attrGet('color') }) },
  colouredMark: { mark: 'highlight', getAttrs: (tok) => ({ color: tok.attrGet('color') }) },

  em: { mark: 'italic' },
  strong: { mark: 'bold' },
  s: { mark: 'strike' },
  mark: { mark: 'highlight' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }),
  },
  code_inline: { mark: 'code', noCloseToken: true },
});

/** Markdown as a document. Empty text still yields a valid one-paragraph doc. */
export function markdownToDoc(markdown: string): ProsemirrorNode {
  const parsed = parser.parse(markdown ?? '');
  const doc = parsed.childCount === 0 ? noteSchema.node('doc', null, [noteSchema.node('paragraph')]) : parsed;
  return liftTaskLists(doc);
}

/**
 * Give table cells the paragraph the schema requires.
 *
 * markdown-it puts inline content directly inside `th`/`td`, but the editor's cells hold
 * `block+`, so text arriving with nothing around it fails to build and takes the whole
 * document with it. Injecting the paragraph tokens here means the cell content goes through
 * exactly the same inline path as every other paragraph — marks, links and code included.
 */
function wrapTableCells(md: MarkdownIt): void {
  md.core.ruler.push('note_table_cells', (state) => {
    const out: (typeof state.tokens)[number][] = [];
    for (const token of state.tokens) {
      if (token.type === 'th_close' || token.type === 'td_close') {
        out.push(new state.Token('paragraph_close', 'p', -1));
      }
      out.push(token);
      if (token.type === 'th_open' || token.type === 'td_open') {
        out.push(new state.Token('paragraph_open', 'p', 1));
      }
    }
    state.tokens = out;
    return true;
  });
}

/**
 * The only HTML this parser will look at.
 *
 * `html: false` stays on, and everything that looks like a tag is still literal text — with
 * two exceptions, matched here by hand: `<span style="color:#hex">` and
 * `<mark style="background-color:#hex">`. They exist because Markdown cannot express colour
 * and those are the tags every editor that supports it emits, so a note stays readable in
 * other tools.
 *
 * The narrowness is the safety. The colour must be a hex literal, the attribute must be
 * exactly this one, and anything else — a class, an event handler, a `url()`, a second
 * declaration — fails to match and is left as text for the reader to see. Note bodies are
 * partly written from meeting transcripts and partly by a model, so "accept one closed shape"
 * is a very different proposition from "allow HTML".
 *
 * A closing tag is only consumed when one is open, so a stray `</span>` in prose stays prose.
 */
function colourTags(md: MarkdownIt): void {
  const OPEN: Array<[RegExp, string]> = [
    [/^<span\s+style="color:\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\s*;?\s*"\s*>/, 'colouredText'],
    [
      /^<mark\s+style="background-color:\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\s*;?\s*"\s*>/,
      'colouredMark',
    ],
  ];
  const CLOSE: Array<[RegExp, string]> = [
    [/^<\/span>/, 'colouredText'],
    [/^<\/mark>/, 'colouredMark'],
  ];

  md.inline.ruler.before('html_inline', 'note_colour', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const rest = state.src.slice(state.pos);
    const open = (state.env.noteColourOpen ??= {}) as Record<string, number>;

    for (const [pattern, name] of OPEN) {
      const m = pattern.exec(rest);
      if (!m) continue;
      if (!silent) {
        const token = state.push(`${name}_open`, 'span', 1);
        token.attrSet('color', m[1]!.toLowerCase());
        open[name] = (open[name] ?? 0) + 1;
      }
      state.pos += m[0].length;
      return true;
    }

    for (const [pattern, name] of CLOSE) {
      const m = pattern.exec(rest);
      // Nothing to close means this is somebody's prose, not our tag.
      if (!m || !open[name]) continue;
      if (!silent) {
        state.push(`${name}_close`, 'span', -1);
        open[name] -= 1;
      }
      state.pos += m[0].length;
      return true;
    }

    return false;
  });
}

/**
 * Turn `- [ ]` bullets into real task items.
 *
 * markdown-it has no notion of GFM checkboxes, and the plugin that adds them emits raw HTML
 * inputs — useless with `html: false`, and not something to switch on for this. Recognising
 * them in the tree afterwards is both simpler and easier to be sure about: it is a pure
 * function over a document, so the round-trip tests cover it directly.
 *
 * A list is converted only when *every* item is a checkbox. A mixed list stays a bullet list
 * with the brackets as literal text, which looks wrong but is at least reversible — quietly
 * promoting the plain items to unchecked tasks would assert something the author never wrote.
 */
function liftTaskLists(node: ProsemirrorNode): ProsemirrorNode {
  const children: ProsemirrorNode[] = [];
  node.forEach((child) => children.push(liftTaskLists(child)));

  if (node.type !== noteSchema.nodes.bulletList || children.length === 0) {
    return node.copy(Fragment.fromArray(children));
  }

  const boxes = children.map(checkboxOf);
  if (boxes.some((b) => b === null)) return node.copy(Fragment.fromArray(children));

  return noteSchema.node(
    'taskList',
    null,
    boxes.map((box) => noteSchema.node('taskItem', { checked: box!.checked }, box!.content)),
  );
}

/** A list item that begins with `[ ]` or `[x]`, with the marker removed. */
function checkboxOf(item: ProsemirrorNode): { checked: boolean; content: Fragment } | null {
  if (item.type !== noteSchema.nodes.listItem || item.childCount === 0) return null;
  const first = item.child(0);
  if (first.type !== noteSchema.nodes.paragraph || first.childCount === 0) return null;

  const lead = first.child(0);
  if (!lead.isText || !lead.text) return null;
  const found = /^\[([ xX])\]\s+/.exec(lead.text);
  if (!found) return null;

  const trimmed = lead.text.slice(found[0].length);
  const inline: ProsemirrorNode[] = [];
  // An empty remainder means the whole first text node was the marker — drop it rather than
  // creating a zero-length text node, which ProseMirror refuses to build.
  if (trimmed) inline.push(noteSchema.text(trimmed, lead.marks));
  first.forEach((child, _offset, index) => {
    if (index > 0) inline.push(child);
  });

  const rest: ProsemirrorNode[] = [first.copy(Fragment.fromArray(inline))];
  item.forEach((child, _offset, index) => {
    if (index > 0) rest.push(child);
  });

  return { checked: found[1]!.toLowerCase() === 'x', content: Fragment.fromArray(rest) };
}
