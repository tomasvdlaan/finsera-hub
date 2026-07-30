import { getSchema, type AnyExtension } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import type { Schema } from '@tiptap/pm/model';

/**
 * What a note is, agreed between the browser and the server.
 *
 * This package exists because the two now edit the same document at the same time. A
 * collaborative editor exchanges ProseMirror steps, and a step is only meaningful against a
 * schema — so if the API's idea of the document differs from the editor's by one node type,
 * steps stop applying and the note quietly stops converging. The schema is therefore a
 * contract, and it lives where contracts live rather than inside either app.
 *
 * The important discovery that makes this possible: `getSchema()` runs in Node with no DOM.
 * A TipTap `Editor` does not — constructing one server-side fails with "there is no window
 * object available" — so the server never builds an editor. It builds the schema, applies
 * steps to a plain `Node`, and converts to and from Markdown, all of which are DOM-free.
 * That is the whole reason the API does not have to carry jsdom.
 *
 * Extensions here are only ever the ones that *define the schema*. Placeholder, drag handles,
 * bubble menus and syntax highlighting are the browser's business and are added on top in
 * RichEditor; none of them adds a node or a mark, so the schemas stay identical.
 */
export const noteExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    /*
     * Switched off here and added back below as its own extension.
     *
     * The browser wants the lowlight version, which syntax-highlights what is inside a fence.
     * It extends CodeBlock, so it registers the same node name with the same attributes and
     * the schema is unchanged — but it can only be substituted for a standalone entry in this
     * array, not for one buried inside StarterKit's bundle. See `replacing` below.
     */
    codeBlock: false,
    /*
     * Underline stays off, and now for a reason that is finally the honest one.
     *
     * Markdown has no underline. Previously this was framed as a limitation of the
     * serialiser; it is not, it is a limitation of the format, and this package owns the
     * serialiser now. Offering a button whose formatting cannot be written down is how you
     * get text that looks right until it is reloaded.
     */
    underline: false,
    link: { openOnClick: false },
  }),
  /*
   * Colour, and the syntax that carries it.
   *
   * Markdown has no colour of its own, which is why it was refused for a long time — a button
   * whose formatting the format cannot express produces text that looks right until it is
   * reloaded, and that is how underline was lost. It is offered now because there *is* a
   * carrier that survives the round trip and renders in other Markdown tools: an HTML span,
   * which is what every editor that supports colour in Markdown emits.
   *
   * TextStyle provides the mark and Color the command. What makes it safe is not the
   * extension but the parser: see markdown/parse.ts, which accepts only a hex colour in
   * exactly this shape and treats every other tag as literal text.
   */
  TextStyle,
  Color,
  // Multicolour, so highlight matches: `==text==` when it is the default, a <mark> with a
  // background when a colour was chosen.
  Highlight.configure({ multicolor: true }),
  /*
   * Images are inline, and the round-trip test is why.
   *
   * They used to be block nodes. `![alt](src)` is inline syntax, so markdown-it reports the
   * image inside a paragraph — and a block node cannot go there, so the parser dropped it.
   * Every image in every note would have vanished on the first save, silently, exactly the
   * failure this package exists to make impossible.
   *
   * Inline is also the more faithful model: it is what the format means, and it lets a
   * screenshot sit in the middle of a sentence instead of interrupting it. Base64 is refused
   * either way — the bytes are uploaded and a URL is what lands in the document.
   */
  Image.configure({ inline: true, allowBase64: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  CodeBlock,
  Table,
  TableRow,
  TableHeader,
  TableCell,
];

/**
 * The same list with one extension swapped for a richer version of itself.
 *
 * Only for extensions that keep the node name and attributes — CodeBlockLowlight for
 * CodeBlock is the case this exists for. Anything that changes the schema must not go through
 * here: the server applies the browser's steps against `noteSchema`, and a node the two sides
 * disagree about is not a missing feature, it is edits that stop arriving.
 */
export function replacing(name: string, replacement: AnyExtension): AnyExtension[] {
  return (noteExtensions as AnyExtension[]).filter((e) => e.name !== name).concat(replacement);
}

/**
 * The schema itself.
 *
 * Built once at module load. Both the editor and the authority hold this exact object, which
 * is what lets `Step.fromJSON` on the server reconstitute a step the browser produced.
 */
export const noteSchema: Schema = getSchema(noteExtensions);

/**
 * An empty document.
 *
 * `doc` requires at least one block, so this is not `{type:'doc',content:[]}` — that fails
 * validation, and it fails at the moment somebody opens a brand new note.
 */
export const emptyDoc = () => noteSchema.node('doc', null, [noteSchema.node('paragraph')]);
