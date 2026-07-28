import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk.js';

describe('chunkText', () => {
  it('keeps a short document as one chunk', () => {
    expect(chunkText('One short paragraph.')).toHaveLength(1);
  });

  it('splits on paragraph boundaries', () => {
    const text = Array.from({ length: 8 }, (_, i) => `Paragraph ${i}. ${'x'.repeat(300)}`).join('\n\n');
    const chunks = chunkText(text, 600);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 900)).toBe(true);
  });

  it('overlaps chunks so a boundary cannot hide the answer', () => {
    const text = Array.from({ length: 6 }, (_, i) => `Section ${i}. ${'y'.repeat(400)}`).join('\n\n');
    const chunks = chunkText(text, 500, 120);
    const tail = chunks[0]!.content.slice(-60);
    expect(chunks[1]!.content).toContain(tail.slice(0, 30));
  });

  it('numbers chunks in reading order', () => {
    const text = Array.from({ length: 5 }, (_, i) => `Part ${i}. ${'z'.repeat(400)}`).join('\n\n');
    expect(chunkText(text, 500).map((c) => c.ordinal)).toEqual([0, 1, 2, 3, 4].slice(0, chunkText(text, 500).length));
  });
});
