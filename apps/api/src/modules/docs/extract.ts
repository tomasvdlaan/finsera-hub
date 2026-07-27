/**
 * Text extraction and chunking.
 *
 * Formats that cannot be read are stored but not indexed, and the UI says so — silently
 * returning no search results for a document that is plainly there is worse than
 * admitting it was never indexed.
 */

const TEXT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/html',
];

export function canExtract(mimeType: string): boolean {
  return TEXT_TYPES.some((t) => mimeType.startsWith(t));
}

export function extractText(data: Buffer, mimeType: string): string | null {
  if (!canExtract(mimeType)) return null;

  let text = data.toString('utf8');
  if (mimeType.startsWith('text/html')) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  // Collapse whitespace but keep paragraph breaks — they are the best chunk boundaries.
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() || null;
}

export interface Chunk {
  ordinal: number;
  content: string;
}

/**
 * Split text into overlapping chunks on paragraph boundaries.
 *
 * Overlap exists so a sentence spanning a boundary is still findable: without it, the one
 * paragraph that answers the question can be split exactly through its answer.
 */
export function chunkText(text: string, maxChars = 1200, overlapChars = 150): Chunk[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let current = '';

  const push = () => {
    const content = current.trim();
    if (content) chunks.push({ ordinal: chunks.length, content });
  };

  for (const paragraph of paragraphs) {
    // A single oversized paragraph is split on sentence boundaries rather than mid-word.
    if (paragraph.length > maxChars) {
      push();
      current = '';
      for (const sentence of paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph]) {
        if (current.length + sentence.length > maxChars) {
          push();
          current = current.slice(-overlapChars);
        }
        current += sentence;
      }
      continue;
    }

    if (current.length + paragraph.length + 2 > maxChars) {
      push();
      current = current.slice(-overlapChars);
    }
    current += (current ? '\n\n' : '') + paragraph;
  }
  push();

  return chunks;
}
