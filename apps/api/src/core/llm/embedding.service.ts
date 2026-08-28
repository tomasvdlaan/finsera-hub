import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { UsageService, type UsageContext } from '../usage/usage.service.js';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed, embedMany, type EmbeddingModel } from 'ai';
import { EMBEDDING_DIMENSIONS } from './embedding.constants.js';

export { EMBEDDING_DIMENSIONS };

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

  /**
   * Optional, exactly as on LlmService: metering must never be the reason a search cannot run.
   */
  constructor(@Optional() @Inject(UsageService) private readonly usage?: UsageService) {}

  /**
   * Tokens for an embedding call.
   *
   * The SDK reports usage inconsistently across embedding providers, so this falls back to
   * four characters per token — the standard approximation. Marked in the record as an
   * estimate would be better than a comment, but the column would be one more thing to read
   * on a row that is already a rounding error next to a single generation call.
   */
  private async meter(texts: string[], reported: number | undefined, ctx?: UsageContext) {
    if (!this.usage) return;
    const tokens = reported ?? Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);
    await this.usage.recordTokens(
      'google',
      'embed',
      process.env.MODEL_EMBEDDING ?? 'google:gemini-embedding-001',
      { inputTokens: tokens },
      // 'unattributed' rather than a guess: every real caller passes a context, so a row
      // landing here means a new call site was added without one, and it should look like
      // the gap it is instead of being quietly filed under somebody else's name.
      ctx ?? { module: 'unattributed', feature: 'embed' },
    );
  }

  async embedOne(text: string, ctx?: UsageContext): Promise<number[]> {
    const result = await embed({
      model: this.resolve(),
      value: text,
      providerOptions: this.providerOptions(),
    });
    await this.meter([text], (result as { usage?: { tokens?: number } }).usage?.tokens, ctx);
    return result.embedding;
  }

  /**
   * Embed many chunks. Batched because a 40-page contract is hundreds of chunks, and one
   * request per chunk would be both slow and rate-limited.
   */
  async embedBatch(texts: string[], ctx?: UsageContext): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = this.resolve();
    const out: number[][] = [];

    const BATCH = 64;
    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH);
      const batch = await embedMany({
        model,
        values: slice,
        providerOptions: this.providerOptions(),
      });
      await this.meter(slice, (batch as { usage?: { tokens?: number } }).usage?.tokens, ctx);
      out.push(...batch.embeddings);
    }

    this.logger.log(`Embedded ${texts.length} chunk(s)`);
    return out;
  }
}
