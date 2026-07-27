import { Injectable, Logger } from '@nestjs/common';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed, embedMany, type EmbeddingModel } from 'ai';

/**
 * Vector width for stored embeddings.
 *
 * Lives in core because it is a property of the embedding configuration, not of any one
 * module's schema — modules that store vectors read it from here. 768 rather than the
 * provider default of 3072 because pgvector's HNSW index caps at 2000 dimensions.
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Embeddings for the knowledge layer (AI plan §3.3).
 *
 * Separate from LlmService because embedding and generation are different models with
 * different economics — and because the embedding model is far more expensive to change:
 * switching it invalidates every stored vector, which is a full re-embed rather than a
 * migration. Chosen once, deliberately.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  /**
   * Ask the provider for a reduced-dimension vector.
   *
   * gemini-embedding-001 returns 3072 dimensions by default, but pgvector's HNSW index
   * caps at 2000 — accepting the default would silently cost us the index and turn every
   * similarity search into a sequential scan. 768 keeps the index and the schema.
   */
  private providerOptions() {
    return { google: { outputDimensionality: EMBEDDING_DIMENSIONS } };
  }

  /** Model spec as 'provider:model', matching LlmService's convention. */
  private resolve(): EmbeddingModel {
    const spec = process.env.MODEL_EMBEDDING ?? 'google:gemini-embedding-001';
    const [provider, ...rest] = spec.split(':');
    const modelId = rest.join(':');

    switch (provider) {
      case 'google': {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set');
        return createGoogleGenerativeAI({ apiKey }).textEmbeddingModel(modelId);
      }
      default:
        throw new Error(`Unsupported embedding provider '${provider}' in '${spec}'.`);
    }
  }

  static isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  }

  async embedOne(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.resolve(),
      value: text,
      providerOptions: this.providerOptions(),
    });
    return embedding;
  }

  /**
   * Embed many chunks. Batched because a 40-page contract is hundreds of chunks, and one
   * request per chunk would be both slow and rate-limited.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = this.resolve();
    const out: number[][] = [];

    const BATCH = 64;
    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH);
      const { embeddings } = await embedMany({
        model,
        values: slice,
        providerOptions: this.providerOptions(),
      });
      out.push(...embeddings);
    }

    this.logger.log(`Embedded ${texts.length} chunk(s)`);
    return out;
  }
}
