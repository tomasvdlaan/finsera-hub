import { describe, expect, it } from 'vitest';
import { isStale } from './types.js';

/**
 * Whether what we indexed is still what is in the file.
 *
 * Small enough to look obviously right and load-bearing enough to be worth pinning: it
 * decides whether a search result carries "out of date", and a search result that quietly
 * omits it is somebody quoting last month's notice period with confidence.
 */
describe('isStale', () => {
  const iso = (offsetMinutes: number) =>
    new Date(Date.UTC(2026, 8, 9, 12, offsetMinutes)).toISOString();

  it('is stale when the file changed after it was read', () => {
    expect(isStale({ indexedAt: iso(0), remoteModifiedAt: iso(10) })).toBe(true);
  });

  it('is not stale when it was read after the file changed', () => {
    expect(isStale({ indexedAt: iso(10), remoteModifiedAt: iso(0) })).toBe(false);
  });

  /** A sync stamps both from the same read; identical timestamps are caught up, not behind. */
  it('is not stale on identical timestamps', () => {
    expect(isStale({ indexedAt: iso(0), remoteModifiedAt: iso(0) })).toBe(false);
  });

  /**
   * Never stale on a missing stamp, in either direction.
   *
   * A document nobody has checked, and a document whose text could not be read at all, are
   * both "we do not know" — and rendering "out of date" for one of those is a claim the
   * platform cannot support. Local documents have neither stamp and can never be stale
   * against anything, which is the same answer for the same reason.
   */
  it('claims nothing when a stamp is missing', () => {
    expect(isStale({ indexedAt: null, remoteModifiedAt: iso(10) })).toBe(false);
    expect(isStale({ indexedAt: iso(0), remoteModifiedAt: null })).toBe(false);
    expect(isStale({})).toBe(false);
  });
});
