/**
 * Chunking for the knowledge layer.
 *
 * Format-specific extraction moved to core's file-type handlers, so this file is only
 * about splitting text for embedding — one concern, one place.
 */

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
