/**
 * Vector width for stored embeddings.
 *
 * Its own file, with no imports: schema files need this constant, and pulling it from
 * the embedding service would drag the AI SDK into schema loading — which breaks the
 * migration tool, and couples a table definition to a service.
 *
 * 768 rather than the provider default of 3072, because pgvector's HNSW index caps at
 * 2000 dimensions and exceeding it silently turns every similarity search into a
 * sequential scan.
 */
export const EMBEDDING_DIMENSIONS = 768;
