/**
 * File-type handlers (core infrastructure).
 *
 * A handler is everything the platform knows how to do with one family of files:
 * recognise it, extract its text for search, and render a preview. Adding a format is
 * writing one handler and registering it — no changes to storage, documents, search or
 * the UI, which each work in terms of these shapes rather than in terms of formats.
 *
 * Lives in core rather than the documents module because files are core infrastructure
 * (Master §10) — Meeting Notes will embed images through the same path.
 */

/**
 * What a preview renders as. The UI switches on `kind`, so a new format only needs a new
 * handler if it fits an existing kind, and a new UI branch only if it genuinely does not.
 */
export type Preview =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; text: string }
  /** Pre-sanitised on the server — never assembled from untrusted markup in the browser. */
  | { kind: 'html'; html: string }
  | { kind: 'sheets'; sheets: Array<{ name: string; rows: string[][]; truncated: boolean }> }
  /**
   * The browser renders the bytes itself, having fetched them authenticated.
   *
   * Used where a client-side renderer beats anything the server can produce: PDFs and
   * images natively, Word through docx-preview, which reproduces the actual page layout
   * rather than the semantic skeleton a server-side conversion gives.
   */
  | { kind: 'binary'; mimeType: string; hint: 'image' | 'pdf' | 'docx' }
  | { kind: 'none'; reason: string };

export interface FileTypeHandler {
  /** Stable id, also the label key. */
  id: string;
  label: string;

  /**
   * Does this handler own the file? Filename is consulted as well as mime type, because
   * browsers routinely send application/octet-stream or nothing at all.
   */
  matches(mimeType: string, filename: string): boolean;

  /**
   * Plain text for search and embeddings. Returning null means "stored but not indexed",
   * which the UI states plainly rather than silently returning no results.
   */
  extract?(data: Buffer): Promise<string | null>;

  /** A preview for the reader. Absent means download-only. */
  preview?(data: Buffer, mimeType: string): Promise<Preview>;
}

export const extensionOf = (filename: string): string =>
  filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';

/** Collapse whitespace but keep paragraph breaks — the best chunk boundaries. */
export function normaliseText(text: string): string | null {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned || null;
}
