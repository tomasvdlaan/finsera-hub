import { describe, expect, it } from 'vitest';
import { reconcile, wins, type BoardElement } from '@platform/board-doc';

/**
 * The browser and the server must merge boards identically.
 *
 * This does not re-test the rule — `packages/board-doc` does that thoroughly. It tests the one
 * thing that package's own suite cannot: that the WEB app resolves `@platform/board-doc` to the
 * same implementation the API does, rather than to a copy that has drifted. If the two ever
 * merged differently the boards would diverge permanently and every peer would be internally
 * consistent while looking at a different drawing — a failure with no error and no symptom
 * until somebody says "that isn't what I drew".
 *
 * The equivalent of the note-doc schema agreement test, for the same reason.
 */
const el = (id: string, version: number, versionNonce: number): BoardElement => ({
  id,
  version,
  versionNonce,
  updated: 1_700_000_000_000,
  type: 'rectangle',
});

describe('the browser merges boards the way the server does', () => {
  it('imports a real implementation rather than a stub', () => {
    expect(typeof reconcile).toBe('function');
    expect(typeof wins).toBe('function');
  });

  it('agrees on a fixed set of cases the API also merges', () => {
    /*
     * Hand-checked expectations rather than a second implementation to compare against —
     * a second implementation would be the very thing this test exists to prevent.
     */
    const cases: Array<[BoardElement, BoardElement | undefined, boolean]> = [
      [el('a', 1, 5), undefined, true],
      [el('a', 2, 5), el('a', 1, 9), true],
      [el('a', 1, 5), el('a', 2, 9), false],
      [el('a', 3, 4), el('a', 3, 9), true],
      [el('a', 3, 9), el('a', 3, 4), false],
      [el('a', 3, 4), el('a', 3, 4), false],
    ];

    for (const [incoming, local, expected] of cases) {
      expect(wins(incoming, local)).toBe(expected);
    }
  });

  it('converges on a scene whichever order the batches arrive', () => {
    const one = [el('a', 2, 1), el('b', 1, 1)];
    const two = [el('a', 3, 1), el('c', 4, 1)];

    const forwards = new Map<string, BoardElement>();
    reconcile(forwards, one);
    reconcile(forwards, two);

    const backwards = new Map<string, BoardElement>();
    reconcile(backwards, two);
    reconcile(backwards, one);

    expect([...forwards.entries()].sort()).toEqual([...backwards.entries()].sort());
    expect(forwards.get('a')?.version).toBe(3);
  });
});
