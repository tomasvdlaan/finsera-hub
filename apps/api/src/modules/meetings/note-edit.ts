/**
 * Writing into a note body, by section.
 *
 * The note-taking behaviour has always been able to do this for its own heading, through
 * `mergeAiNotes`. This is the same idea generalised, so the assistant can be asked to write
 * something down rather than only to read.
 *
 * The whole reason the note body is Markdown is that a model can read and rewrite it. That
 * argument only pays off if something actually lets it, and until now nothing did: the
 * assistant could search notes, summarise them and propose action points, and if you asked it
 * to write one it correctly told you it could not.
 *
 * Pure string functions, so the rules below are testable without a database.
 */

/** Headings are matched on their text, case-insensitively, at h2 or h3. */
const headingPattern = (heading: string) =>
  new RegExp(`^(#{2,3})\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');

/**
 * Append a block to the end of a note.
 *
 * The safe operation, and the one to reach for. It cannot destroy anything, which matters
 * because a note body has no version history — an overwrite is unrecoverable and silent.
 */
export function appendToNote(body: string, markdown: string): string {
  const addition = markdown.trim();
  if (!addition) return body;
  return body.trim() ? `${body.trimEnd()}\n\n${addition}\n` : `${addition}\n`;
}

/**
 * Replace everything under a heading, or add the section if it is not there.
 *
 * Bounded on purpose: it rewrites one section and cannot touch a word outside it. The section
 * ends at the next heading of the same level or higher, so writing under "Decisions" cannot
 * swallow "Follow-up" — which is the failure that would quietly eat half a meeting.
 */
export function replaceSection(body: string, heading: string, markdown: string): string {
  const match = headingPattern(heading).exec(body);
  const content = markdown.trim();

  if (!match || match.index === undefined) {
    return appendToNote(body, `## ${heading}\n\n${content}`);
  }

  const level = match[1]!.length;
  const headingLine = match[0];
  const after = body.slice(match.index + headingLine.length);

  // A heading of the same level or higher closes the section. A deeper one belongs to it.
  const nextHeading = new RegExp(`\\n#{1,${level}}\\s`).exec(after);
  const tail = nextHeading ? after.slice(nextHeading.index) : '';

  return `${body.slice(0, match.index)}${headingLine}\n\n${content}\n${tail}`;
}

/** The `##` and `###` headings a note contains, so the assistant can be told what exists. */
export function headingsOf(body: string): string[] {
  return [...body.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((m) => m[1]!);
}
