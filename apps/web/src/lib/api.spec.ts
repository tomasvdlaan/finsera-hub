import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `auth.ts` builds a UserManager at import time and reads `window.location`, so importing the
 * API client for real would need a DOM to check something that has nothing to do with one.
 * Mocked before import rather than worked around.
 */
vi.mock('./auth.js', () => ({ getUser: async () => null }));

const { api } = await import('./api.js');

/**
 * What the client does with a response body.
 *
 * The case that brought this here: Nest serialises a handler returning `null` as a 200 with
 * no body at all. `GET /scrum/projects/:id/sprint` does exactly that for a project with no
 * active sprint — a correct, expected answer — and `res.json()` threw "Unexpected end of JSON
 * input", which surfaced on the board as a red parse error where a sprint should have been.
 *
 * Worth a test rather than a fix and a shrug, because every future endpoint that can honestly
 * answer "nothing" walks into it, and the symptom names the wrong culprit.
 */
describe('api response bodies', () => {
  const respond = (init: { status?: number; body?: string }) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(init.body || null, { status: init.status ?? 200 })),
    );

  beforeEach(() => vi.unstubAllGlobals());

  it('reads an empty 200 as null rather than throwing', async () => {
    respond({ status: 200, body: '' });
    await expect(api.get('/scrum/projects/x/sprint')).resolves.toBeNull();
  });

  it('still parses a body that is there', async () => {
    respond({ status: 200, body: JSON.stringify({ name: 'Sprint 1' }) });
    await expect(api.get('/scrum/sprints/x')).resolves.toEqual({ name: 'Sprint 1' });
  });

  it('reads a literal null body as null', async () => {
    // Distinct from the empty case: some handlers do serialise the four characters.
    respond({ status: 200, body: 'null' });
    await expect(api.get('/scrum/projects/x/sprint')).resolves.toBeNull();
  });

  it('leaves 204 as undefined, which is what a delete returns', async () => {
    respond({ status: 204 });
    await expect(api.del('/core/comments/x')).resolves.toBeUndefined();
  });

  it('raises the server’s message, not a parse error, when the call fails', async () => {
    respond({ status: 400, body: JSON.stringify({ message: 'That sprint is finished.' }) });
    await expect(api.post('/scrum/sprints/x/start', {})).rejects.toThrow(
      'That sprint is finished.',
    );
  });

  it('falls back to the status when a failure carries no body', async () => {
    respond({ status: 502, body: '' });
    await expect(api.get('/scrum/sprints')).rejects.toThrow(/502/);
  });
});
