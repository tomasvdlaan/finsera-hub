import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from './embedding.constants.js';
import { chunks } from '../../modules/docs/docs.schema.js';

/**
 * The vector width is declared twice: once in core's embedding configuration, once as a
 * literal in the docs schema, because the migration tool loads schema files in isolation
 * and cannot follow an import across the tree.
 *
 * Two declarations of the same number will drift eventually, and the failure mode is
 * ugly — embeddings that no longer fit their column, discovered on the next upload. This
 * test is what makes the duplication safe.
 */
describe('embedding dimensions', () => {
  it('matches the width declared on the chunks column', () => {
    const columnType = chunks.embedding.getSQLType();
    expect(columnType).toBe(`vector(${EMBEDDING_DIMENSIONS})`);
  });

  it('stays within pgvector’s HNSW index limit', () => {
    // Above 2000, pgvector refuses to index and every search becomes a sequential scan.
    expect(EMBEDDING_DIMENSIONS).toBeLessThanOrEqual(2000);
  });
});
