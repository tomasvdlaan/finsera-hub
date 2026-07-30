import type { Node as ProsemirrorNode } from '@tiptap/pm/model';

/**
 * Where a section lives in the document.
 *
 * These replace the string arithmetic in the API's `note-edit.ts`, which found headings with
 * a regular expression and rebuilt the body by slicing. That worked when one writer owned the
 * whole string. It cannot survive collaboration: a rewritten body is one enormous replacement
 * covering every position in the document, so a person typing anywhere at the same moment has
 * their edit rebased into nonsense or dropped.
 *
 * Positions instead. The assistant writing under "Decisions" produces a step that touches
 * only the range between that heading and the next one, so somebody typing in the paragraph
 * above is untouched and ProseMirror rebases the two against each other correctly. That is
 * the entire reason the note is a document on the server and no longer a string.
 */
export interface SectionRange {
  /** Start of the section's content — immediately after the heading node. */
  from: number;
  /** End of the section's content, before the next heading of the same level or higher. */
  to: number;
  level: number;
}

/** The `##` and `###` headings a note contains, so the assistant can be told what exists. */
export function headingsOf(doc: ProsemirrorNode): string[] {
  const found: string[] = [];
  doc.forEach((node) => {
    if (node.type.name === 'heading' && node.attrs.level >= 2) found.push(node.textContent);
  });
  return found;
}

/**
 * Find a section by its heading text, case-insensitively.
 *
 * Bounded on purpose, exactly as the string version was: the range stops at the next heading
 * of the same level or higher, so writing under "Decisions" cannot swallow "Follow-up" — the
 * failure that would quietly eat half a meeting. A deeper heading belongs to the section.
 */
export function sectionRange(doc: ProsemirrorNode, heading: string): SectionRange | null {
  const wanted = heading.trim().toLowerCase();

  let from = -1;
  let level = 0;
  let offset = 0;

  for (let i = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i);
    const isHeading = node.type.name === 'heading';
    const nodeLevel = isHeading ? (node.attrs.level as number) : 0;

    if (from === -1) {
      if (isHeading && nodeLevel >= 2 && node.textContent.trim().toLowerCase() === wanted) {
        from = offset + node.nodeSize;
        level = nodeLevel;
      }
    } else if (isHeading && nodeLevel <= level) {
      return { from, to: offset, level };
    }
    offset += node.nodeSize;
  }

  return from === -1 ? null : { from, to: doc.content.size, level };
}

/** The end of the document — where an append goes. */
export const endOfDoc = (doc: ProsemirrorNode): number => doc.content.size;
