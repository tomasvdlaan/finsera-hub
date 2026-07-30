import {
  Fragment,
  Node as ProsemirrorNode,
  Transform,
  markdownToDoc,
  noteSchema,
  sectionRange,
} from '@platform/note-doc';

/**
 * Writing into a note, by position rather than by string surgery.
 *
 * This replaces the regular expressions that used to find a heading in the body text and
 * rebuild the whole string around it. The old functions were correct in isolation and wrong
 * in company: rewriting the body produces a change covering every character in the document,
 * so anyone typing at that moment either lost their sentence or had it rebased into the
 * middle of the assistant's paragraph.
 *
 * These describe the same two operations as bounded edits. Appending touches the end of the
 * document and nothing else; replacing a section touches the range between one heading and
 * the next and nothing else. Everything outside is untouched at the position level, so
 * concurrent typing merges instead of colliding — which is what makes it safe for the
 * assistant to write into a note while the meeting is still going on.
 *
 * Both take a `Transform` and mutate it. They produce no steps at all when there is nothing
 * to do, which is what stops an empty AI response bumping the version and waking every
 * client for nothing.
 */

/**
 * Add a block to the end of the note.
 *
 * The safe operation, and the one to reach for. It cannot destroy anything, which matters
 * because a note body has no version history — an overwrite is unrecoverable and silent.
 */
export function appendMarkdown(tr: Transform, markdown: string): void {
  const content = parseBlocks(markdown);
  if (content.childCount === 0) return;

  const doc = tr.doc;
  const trailing = trailingEmptyParagraph(doc);
  // Writing after a note that ends in an empty paragraph would leave a blank line behind and
  // then another after the next append, so the note slowly grows a gap at the bottom.
  if (trailing !== null) tr.replaceWith(trailing, doc.content.size, content);
  else tr.insert(doc.content.size, content);
}

/**
 * Replace everything under a heading, adding the section if it is not there.
 *
 * The section ends at the next heading of the same level or higher, so writing under
 * "Decisions" cannot swallow "Follow-up".
 */
export function replaceSectionMarkdown(tr: Transform, heading: string, markdown: string): void {
  const range = sectionRange(tr.doc, heading);
  if (!range) {
    appendMarkdown(tr, `## ${heading.trim()}\n\n${markdown.trim()}`);
    return;
  }

  const content = parseBlocks(markdown);
  const replacement =
    content.childCount > 0 ? content : Fragment.from(noteSchema.node('paragraph'));

  // Nothing to do when the section already says exactly this — the note-taking behaviour
  // rewrites its own section every ninety seconds and is usually restating the same thing.
  const current = tr.doc.slice(range.from, range.to).content;
  if (current.eq(replacement)) return;

  tr.replaceWith(range.from, range.to, replacement);
}

/** Markdown as top-level blocks, ready to be inserted. */
function parseBlocks(markdown: string): Fragment {
  const trimmed = (markdown ?? '').trim();
  if (!trimmed) return Fragment.empty;
  return markdownToDoc(trimmed).content;
}

/** The position where a trailing empty paragraph starts, or null if there is not one. */
function trailingEmptyParagraph(doc: ProsemirrorNode): number | null {
  if (doc.childCount === 0) return null;
  const last = doc.child(doc.childCount - 1);
  if (last.type !== noteSchema.nodes.paragraph || last.content.size > 0) return null;
  // A document whose only node is that paragraph is an empty note; replacing it is right.
  return doc.content.size - last.nodeSize;
}
