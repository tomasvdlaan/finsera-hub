import { describe, expect, it } from 'vitest';
import { captureFailure, failureMessage } from './failure.js';

const ctx = { requestId: 'req-1', model: 'google:gemini-3.1-pro-preview', steps: 2 };

/**
 * What survives a failed answer.
 *
 * Every case here is one that actually happened and was recorded uselessly: a provider object
 * that stringified to nothing, a model retired underneath us, an account out of credit. The
 * point of the tests is that the *reason* reaches the database, not merely that something did.
 */
describe('captureFailure', () => {
  it('does not reduce a structured provider error to [object Object]', () => {
    // The real one. `String(error)` on a plain object gives six useless words, and that is
    // exactly what was stored for the most informative kind of failure there is.
    const captured = captureFailure({ error: { code: 402, reason: 'insufficient credits' } }, ctx);
    expect(captured.message).not.toContain('[object Object]');
    expect(captured.message).toContain('insufficient credits');
  });

  it('keeps the class, the status and the provider body', () => {
    const error = Object.assign(new Error('Payment required'), {
      name: 'AI_APICallError',
      statusCode: 402,
      responseBody: '{"error":{"message":"can only afford 4148 tokens"}}',
    });
    const captured = captureFailure(error, ctx);
    expect(captured.name).toBe('AI_APICallError');
    expect(captured.status).toBe(402);
    expect(captured.body).toContain('4148');
  });

  it('records the model and how far the run got', () => {
    // A failure on the first step and one on the seventh are different bugs, and the stored
    // record could not tell them apart.
    const captured = captureFailure(new Error('boom'), ctx);
    expect(captured.model).toBe('google:gemini-3.1-pro-preview');
    expect(captured.steps).toBe(2);
    expect(captured.requestId).toBe('req-1');
  });

  it('unwraps the cause chain, where the real reason usually is', () => {
    const root = new Error('ECONNRESET');
    const wrapped = new Error('Failed after 3 attempts', { cause: root });
    expect(captureFailure(wrapped, ctx).causes).toEqual(['Error: ECONNRESET']);
  });

  it('truncates a body rather than storing a megabyte of HTML', () => {
    const captured = captureFailure(
      Object.assign(new Error('Bad gateway'), { responseBody: 'x'.repeat(9000) }),
      ctx,
    );
    expect(captured.body!.length).toBeLessThan(4200);
    expect(captured.body).toContain('truncated');
  });

  it('survives a value that cannot be serialised', () => {
    // This runs inside a catch block: it must not be the thing that throws next.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => captureFailure(circular, ctx)).not.toThrow();

    const hostile = { get boom(): never { throw new Error('nope'); } };
    expect(() => captureFailure(hostile, ctx)).not.toThrow();
  });

  it('keeps the stack short enough to read', () => {
    const captured = captureFailure(new Error('boom'), ctx);
    expect(captured.stack!.split('\n').length).toBeLessThanOrEqual(6);
  });
});

describe('failureMessage', () => {
  it('shows the provider’s own words and the reference, and nothing else', () => {
    const captured = captureFailure(
      Object.assign(new Error('This model is no longer available'), { responseBody: 'huge' }),
      ctx,
    );
    const shown = failureMessage(captured);
    expect(shown).toContain('This model is no longer available');
    expect(shown).toContain('req-1');
    // The body and the stack are for whoever is fixing it; they are in the database.
    expect(shown).not.toContain('huge');
  });

  it('says something when the failure said nothing', () => {
    expect(failureMessage(captureFailure(new Error(''), ctx))).toContain('without saying why');
  });
});
