/**
 * Chunking for the knowledge layer.
 *
 * In core because more than one module now feeds the knowledge layer: documents have
 * extracted text, meeting notes have a body, and both need splitting the same way for
 * embedding. A module's internals are private, so anything genuinely shared belongs here.
 *
 * Pure functions over strings: no database, no dependencies, no I/O.
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
