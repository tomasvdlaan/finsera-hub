import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isVercelHost, upstreamCredentials } from './vercel-headers.js';

/**
 * Which host each credential is allowed to reach.
 *
 * The page's own bypass secret was typed for one source URL and goes wherever that page
 * points. The proxy secret is account-wide — holding it is enough to reach every report we
 * host — so it goes to Vercel's own hosts and nowhere else. A page's source URL is typed by
 * a person and can be any origin, which is the whole reason this file exists.
 */
describe('what the upstream is told', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.VERCEL_PROXY_SECRET = 'the-account-secret';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('sends both to a Vercel deployment', () => {
    expect(upstreamCredentials('https://duce-report.vercel.app/', 'page-secret')).toEqual({
      'x-vercel-protection-bypass': 'page-secret',
      'x-proxy-secret': 'the-account-secret',
    });
  });

  it('never sends the account secret anywhere else', () => {
    for (const elsewhere of [
      'https://rapport.duce.nl/',
      'https://evil.example/',
      // The near-misses a string check would wave through.
      'https://evilvercel.app/',
      'https://vercel.app.evil.example/',
      'https://vercel.app@evil.example/',
    ]) {
      const headers = upstreamCredentials(elsewhere, 'page-secret');
      expect(headers['x-proxy-secret'], elsewhere).toBeUndefined();
      // The page's own secret still travels: an admin typed it for this exact source.
      expect(headers['x-vercel-protection-bypass'], elsewhere).toBe('page-secret');
    }
  });

  it('sends nothing at all when neither is configured', () => {
    delete process.env.VERCEL_PROXY_SECRET;
    expect(upstreamCredentials('https://duce-report.vercel.app/', null)).toEqual({});
  });

  it('treats an unset secret and an empty one alike', () => {
    // A header with no value is not the same as no header, and Vercel reads it as a failed
    // match rather than as an absent one — so a blank env var must not produce a header.
    process.env.VERCEL_PROXY_SECRET = '   ';
    expect(upstreamCredentials('https://duce-report.vercel.app/', null)).toEqual({});
  });

  it('still works for a page with no bypass secret of its own', () => {
    expect(upstreamCredentials('https://duce-report.vercel.app/report/', null)).toEqual({
      'x-proxy-secret': 'the-account-secret',
    });
  });
});

describe('isVercelHost', () => {
  it('accepts Vercel’s own hosts', () => {
    for (const ok of [
      'https://duce-noord-dashboard.vercel.app/',
      'https://duce-noord-dashboard-finsera.vercel.app/some/path?x=1',
      'https://vercel.app/',
      // Case is normalised by `URL`, so a shouted hostname is still the same host.
      'https://DUCE-REPORT.VERCEL.APP/',
    ]) {
      expect(isVercelHost(ok), ok).toBe(true);
    }
  });

  it('refuses everything else, including the lookalikes', () => {
    for (const no of [
      'https://vercel.app.evil.example/',
      'https://evilvercel.app/',
      'https://vercel.app@evil.example/',
      'https://finsera.nl/',
      'not-a-url',
      '',
    ]) {
      expect(isVercelHost(no), no).toBe(false);
    }
  });
});
