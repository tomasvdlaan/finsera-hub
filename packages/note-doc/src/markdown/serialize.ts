import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import type { Node as ProsemirrorNode } from '@tiptap/pm/model';
import { noteSchema } from '../schema.js';

type Nodes = ConstructorParameters<typeof MarkdownSerializer>[0];
type Marks = ConstructorParameters<typeof MarkdownSerializer>[1];

/*
 * Where the node renderers come from.
 *
 * prosemirror-markdown ships correct renderers for most of this under CommonMark's names —
 * `bullet_list`, `code_block`, `hard_break`. TipTap names the same nodes in camelCase. So the
 * ones whose attributes also match are re-keyed and reused rather than rewritten: paragraph,
 * text, heading, image, hardBreak and horizontalRule are the library's, and any bug fixed
 * upstream is fixed here.
 *
 * The rest are written out below, each because TipTap's node differs from CommonMark's in a
 * way that matters — a different attribute name, or a behaviour worth correcting.
 */
const reused = defaultMarkdownSerializer.nodes;

const nodes: Nodes = {
  doc: reused.doc!,
  paragraph: reused.paragraph!,
  text: reused.text!,
  heading: reused.heading!,
  image: reused.image!,
  hardBreak: reused.hard_break!,
  horizontalRule: reused.horizontal_rule!,
  listItem: reused.list_item!,

  /**
   * A blockquote that does not corrupt itself over an empty line.
   *
   * The library's version wraps every child in `> `. An empty paragraph as the first child
   * serialises to a bare `> ` line, and the next child's opening `**` then comes out doubled:
   *
   *     > **Decision:** Weekly refresh          (correct)
   *     > \n> ****Decision:** Weekly refresh    (with an empty first paragraph)
   *
   * Four asterisks do not parse back, so the bold is gone and two stray characters are in the
   * note — permanently, and with nothing on screen to say so. It is reachable by putting the
   * caret before quoted text and pressing Enter, which is an ordinary thing to do.
   *
   * Markdown has no way to express an empty paragraph inside a quote: a bare `>` is a blank
   * quoted line, which is exactly what the parser discards on the way back in. So skipping
   * them loses nothing and the collision cannot happen. Only serialisation is affected — an
   * empty paragraph in a quote stays perfectly legal while you are typing.
   */
  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => {
      let written = 0;
      node.forEach((child) => {
        if (child.textContent.length === 0 && child.childCount === 0) return;
        state.render(child, node, written);
        written += 1;
      });
      // A quote holding nothing but blank lines still needs one line, or the wrapper emits a
      // prefix with no content and swallows the block after it.
      if (written === 0) state.render(node.child(0), node, 0);
    });
  },

  // `-` rather than the library's `*`: it is what the note templates and the note-taking
  // behaviour already emit, and a document that mixes both looks like two authors.
  bulletList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },

  // TipTap calls the first number `start`; CommonMark's serializer calls it `order`.
  orderedList(state, node) {
    const start = (node.attrs.start as number | undefined) ?? 1;
    const maxWidth = String(start + node.childCount - 1).length;
    const space = state.repeat(' ', maxWidth + 2);
    state.renderList(node, space, (i) => {
      const label = String(start + i);
      return `${state.repeat(' ', maxWidth - label.length)}${label}. `;
    });
  },

  // TipTap calls the fence's language `language`; CommonMark's serializer calls it `params`.
  codeBlock(state, node) {
    const language = (node.attrs.language as string | null) ?? '';
    state.write(`\`\`\`${language}\n`);
    state.text(node.textContent, false);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
  },

  /*
   * Task lists round-trip as GFM checkboxes — `- [ ]` and `- [x]`.
   *
   * The list itself renders exactly like a bullet list; the box belongs to the item, so that
   * a nested plain list inside a task keeps its own bullets.
   */
  taskList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },
  taskItem(state, node) {
    state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },

  /**
   * A GFM pipe table.
   *
   * Built by hand because prosemirror-markdown has no table support at all. Each cell is
   * serialised as its own little document and then flattened to one line, since a pipe table
   * row cannot contain a newline.
   *
   * **A known and unavoidable loss:** merged cells. The editor can span a cell across columns
   * or rows and GFM has no syntax for it, so a merged cell is written as a single cell and
   * comes back unmerged. Every other format choice in this file is reversible; this one is
   * not, and it is the price of the body being Markdown.
   */
  table(state, node) {
    const rows: string[][] = [];
    node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cellText(cell)));
      rows.push(cells);
    });
    if (rows.length === 0) return;

    // GFM requires a header row, so the first row becomes one whether or not its cells are
    // header cells. A table whose top row is ordinary data reads better as a header than the
    // alternative, which is an empty header nobody asked for.
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (cells: string[]) => {
      const out = [...cells];
      while (out.length < width) out.push('');
      return `| ${out.join(' | ')} |`;
    };

    state.write(pad(rows[0]!));
    state.ensureNewLine();
    state.write(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
    state.ensureNewLine();
    for (const row of rows.slice(1)) {
      state.write(pad(row));
      state.ensureNewLine();
    }
    state.closeBlock(node);
  },
  // Never reached on their own — `table` renders its own rows and cells — but the serializer
  // requires an entry for every node in the schema and throws at construction without them.
  tableRow: skip,
  tableHeader: skip,
  tableCell: skip,
};

const marks: Marks = {
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  highlight: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
  // Both reused: `code` counts backticks so that a span containing one still fences
  // correctly, and `link` handles the autolink shorthand. Neither has a TipTap-specific
  // attribute, so there is nothing to adapt.
  code: defaultMarkdownSerializer.marks.code!,
  link: defaultMarkdownSerializer.marks.link!,
};

/**
 * A ProseMirror document as Markdown.
 *
 * Lists are tight — no blank line between items — because meeting notes are mostly short
 * bullets and the loose form doubles the length of a standup note for no gain.
 */
export const noteSerializer = new MarkdownSerializer(nodes, marks);

export function docToMarkdown(doc: ProsemirrorNode): string {
  return noteSerializer.serialize(doc, { tightLists: true });
}

/** One table cell, flattened to a single line and with its pipes escaped. */
function cellText(cell: ProsemirrorNode): string {
  const content = cell.content.size > 0 ? cell.content : undefined;
  const wrapper = noteSchema.node('doc', null, content ?? [noteSchema.node('paragraph')]);
  return noteSerializer
    .serialize(wrapper, { tightLists: true })
    .trim()
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\|/g, '\\|');
}

function skip(): void {
  /* rendered by the enclosing table */
}
