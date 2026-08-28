import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { resetDb, testDb, truncate } from '../../test/db.js';
import { ModelConfigService } from './model-config.service.js';
import { availableModels } from './models.js';

/**
 * Choosing a model, and the ways that can go wrong quietly.
 *
 * The dangerous failure is not a rejected save — it is a save that succeeds and leaves the
 * platform pointed at a model it cannot reach. Nothing surfaces until the next person asks the
 * assistant a question, by which time the change looks unrelated.
 */
describe('ModelConfigService', () => {
  let service: ModelConfigService;
  const env = { ...process.env };

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE core.platform_settings`);
    // Both providers configured, so the catalogue is fully available unless a test says otherwise.
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
    process.env.MODEL_STRONG = 'anthropic:claude-opus-4-8';
    process.env.MODEL_FAST = 'anthropic:claude-haiku-4-5-20251001';
    service = new ModelConfigService(testDb);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('follows the environment when nothing has been chosen', async () => {
    const current = await service.current();
    expect(current.strong).toBe('anthropic:claude-opus-4-8');
    expect(current.strongFromEnv).toBe(true);
  });

  it('prefers a stored choice over the environment', async () => {
    await service.set('strong', 'google:gemini-3.1-pro-preview');

    const current = await service.current();
    expect(current.strong).toBe('google:gemini-3.1-pro-preview');
    expect(current.strongFromEnv).toBe(false);
  });

  it('takes effect immediately rather than after the cache expires', async () => {
    // A setting that appears not to have saved is one somebody sets twice.
    await service.set('fast', 'google:gemini-3.7-flash');
    expect(await service.specFor('fast')).toBe('google:gemini-3.7-flash');
  });

  it('hands a slot back to the environment when set to null', async () => {
    await service.set('strong', 'google:gemini-3.1-pro-preview');
    await service.set('strong', null);

    const current = await service.current();
    expect(current.strong).toBe('anthropic:claude-opus-4-8');
    expect(current.strongFromEnv).toBe(true);
  });

  it('refuses a model that is not in the catalogue', async () => {
    await expect(service.set('strong', 'openai:gpt-5')).rejects.toThrow(/not a model this platform/);
  });

  it('refuses a model in the wrong slot', async () => {
    // Haiku is a fast model. Accepting it for 'strong' would quietly downgrade every answer.
    await expect(service.set('strong', 'anthropic:claude-haiku-4-5-20251001')).rejects.toThrow(
      /not a model this platform/,
    );
  });

  it('refuses a model whose provider has no key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(service.set('strong', 'anthropic:claude-opus-4-8')).rejects.toThrow(
      /not a model this platform/,
    );
  });

  it('ignores a stored model that has since become unreachable', async () => {
    // Set while the key was present, then the key goes away — a redeploy, a rotated secret.
    // Obeying the row here would break every AI feature until somebody opened this screen.
    await service.set('strong', 'anthropic:claude-sonnet-4-5');
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MODEL_STRONG = 'google:gemini-3.1-pro-preview';
    service.forget();

    const current = await service.current();
    expect(current.strong).toBe('google:gemini-3.1-pro-preview');
    // Reported as coming from the environment, because that is where the answer came from.
    expect(current.strongFromEnv).toBe(true);
  });

  it('stores one row however many times it is set', async () => {
    await service.set('strong', 'google:gemini-3.1-pro-preview');
    await service.set('fast', 'google:gemini-3.7-flash');
    await service.set('strong', 'anthropic:claude-sonnet-4-5');

    const rows = await testDb.execute(sql`SELECT * FROM core.platform_settings`);
    expect(rows.rows).toHaveLength(1);
    // And setting one slot must not clear the other.
    const current = await service.current();
    expect(current.fast).toBe('google:gemini-3.7-flash');
    expect(current.strong).toBe('anthropic:claude-sonnet-4-5');
  });
});

describe('the catalogue', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('offers nothing for a provider with no key', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
    expect(availableModels('strong').every((m) => m.provider === 'google')).toBe(true);
  });

  it('offers only models the rate card can price', () => {
    // An unpriced model works and reports zero on the costs page, which is worse than not
    // offering it: the page keeps drawing while the real spend walks away from it.
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
    expect(availableModels('strong').length).toBeGreaterThan(0);
    expect(availableModels('fast').length).toBeGreaterThan(0);
  });

  it('treats an empty key as no key', () => {
    // An unused provider is usually present-but-empty in .env, and an empty string would pass
    // a `!== undefined` check and then fail at the first real call.
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
    expect(availableModels('fast').some((m) => m.provider === 'anthropic')).toBe(false);
  });
});
