import { describe, expect, it } from 'vitest';
import {
  MAX_ELEMENTS_PER_MESSAGE,
  MAX_VERSION_JUMP,
  reconcile,
  validElement,
  wins,
  type BoardElement,
} from './reconcile.js';

const el = (over: Partial<BoardElement> & { id: string }): BoardElement => ({
  version: 1,
  versionNonce: 100,
  updated: 1_700_000_000_000,
  type: 'rectangle',
  ...over,
});

const mapOf = (...els: BoardElement[]) => new Map(els.map((e) => [e.id, e]));

describe('wins', () => {
  it('accepts an element nothing is held for', () => {
    expect(wins(el({ id: 'a' }), undefined)).toBe(true);
  });

  it('prefers the higher version', () => {
    const low = el({ id: 'a', version: 3 });
    const high = el({ id: 'a', version: 4 });
    expect(wins(high, low)).toBe(true);
    expect(wins(low, high)).toBe(false);
  });

  it('breaks a version tie on the lower nonce, whichever side it arrives from', () => {
    const a = el({ id: 'x', version: 7, versionNonce: 10 });
    const b = el({ id: 'x', version: 7, versionNonce: 99 });
    expect(wins(a, b)).toBe(true);
    expect(wins(b, a)).toBe(false);
  });

  it('does not replace an element with itself', () => {
    const same = el({ id: 'a', version: 2, versionNonce: 5 });
    expect(wins({ ...same }, same)).toBe(false);
  });

  it('ignores `updated` entirely', () => {
    // Excalidraw's own timestamp, carried for its sake. Deciding on it would make the merge
    // depend on the clocks of every machine in the room.
    const older = el({ id: 'a', version: 5, versionNonce: 1, updated: 1 });
    const newer = el({ id: 'a', version: 5, versionNonce: 2, updated: 9_999_999 });
    expect(wins(newer, older)).toBe(false);
    expect(wins(older, newer)).toBe(true);
  });

  /**
   * The property the whole design rests on.
   *
   * For any two versions of an element, exactly one wins, and both ends agree which — no pair
   * where each thinks it beats the other (they would swap for ever), and no pair where neither
   * does unless they are genuinely identical (the loser would never be corrected).
   */
  it('is antisymmetric and total over random pairs', () => {
    let seed = 1;
    const rand = (n: number) => {
      // A deterministic generator: a failure here has to be reproducible, and Math.random
      // would make it a story about "it went red once in CI".
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };

    for (let i = 0; i < 500; i++) {
      const a = el({ id: 'same', version: rand(5), versionNonce: rand(4) });
      const b = el({ id: 'same', version: rand(5), versionNonce: rand(4) });

      const aWins = wins(a, b);
      const bWins = wins(b, a);
      const identical = a.version === b.version && a.versionNonce === b.versionNonce;

      if (identical) {
        expect(aWins).toBe(false);
        expect(bWins).toBe(false);
      } else {
        expect(aWins).not.toBe(bWins);
      }
    }
  });
});

describe('reconcile', () => {
  it('returns only what it accepted, so the caller broadcasts and flushes only that', () => {
    const local = mapOf(el({ id: 'a', version: 5 }), el({ id: 'b', version: 1 }));

    const accepted = reconcile(local, [
      el({ id: 'a', version: 2 }), // stale
      el({ id: 'b', version: 9 }), // newer
      el({ id: 'c', version: 1 }), // unseen
    ]);

    expect(accepted.map((e) => e.id).sort()).toEqual(['b', 'c']);
    expect(local.get('a')?.version).toBe(5);
    expect(local.get('b')?.version).toBe(9);
  });

  it('converges regardless of the order batches arrive in', () => {
    const batchOne = [el({ id: 'a', version: 2 }), el({ id: 'b', version: 1 })];
    const batchTwo = [el({ id: 'a', version: 3 }), el({ id: 'c', version: 4 })];

    const forwards = new Map<string, BoardElement>();
    reconcile(forwards, batchOne);
    reconcile(forwards, batchTwo);

    const backwards = new Map<string, BoardElement>();
    reconcile(backwards, batchTwo);
    reconcile(backwards, batchOne);

    // Two peers seeing the same edits in opposite orders must end up looking at one board.
    expect([...forwards.entries()].sort()).toEqual([...backwards.entries()].sort());
  });

  it('keeps a tombstone that arrives at a higher version than the live element', () => {
    const local = mapOf(el({ id: 'a', version: 3 }));
    reconcile(local, [el({ id: 'a', version: 4, isDeleted: true })]);
    expect(local.get('a')?.isDeleted).toBe(true);
  });

  it('does not let a stale live copy resurrect a deleted element', () => {
    const local = mapOf(el({ id: 'a', version: 8, isDeleted: true }));
    reconcile(local, [el({ id: 'a', version: 2 })]);
    // The peer that deleted it is ahead; a slow peer's older copy must not undo that.
    expect(local.get('a')?.isDeleted).toBe(true);
  });

  it('drops a malformed element without dropping the batch around it', () => {
    const local = new Map<string, BoardElement>();
    const accepted = reconcile(local, [
      el({ id: 'good-1' }),
      { id: 'no-version', type: 'rectangle' },
      el({ id: 'good-2' }),
    ]);
    // One bad shape must not cost a room its edits, let alone its connection.
    expect(accepted.map((e) => e.id)).toEqual(['good-1', 'good-2']);
  });

  it('refuses more elements than one message may carry', () => {
    const local = new Map<string, BoardElement>();
    const huge = Array.from({ length: MAX_ELEMENTS_PER_MESSAGE + 50 }, (_, i) =>
      el({ id: `e${i}` }),
    );
    expect(reconcile(local, huge)).toHaveLength(MAX_ELEMENTS_PER_MESSAGE);
  });
});

describe('validElement', () => {
  it('accepts what the editor actually produces', () => {
    expect(validElement(el({ id: 'a', type: 'freedraw' }))).toBe(true);
  });

  it.each([
    ['a missing id', { version: 1, versionNonce: 1, updated: 1, type: 'rectangle' }],
    ['an id longer than any nanoid', { ...el({ id: 'x'.repeat(65) }) }],
    ['an unknown type', { ...el({ id: 'a' }), type: 'trojan' }],
    ['a negative version', { ...el({ id: 'a' }), version: -1 }],
    ['a fractional version', { ...el({ id: 'a' }), version: 1.5 }],
    ['a non-finite nonce', { ...el({ id: 'a' }), versionNonce: Infinity }],
    ['a non-boolean isDeleted', { ...el({ id: 'a' }), isDeleted: 'yes' }],
    ['not an object at all', 'rectangle'],
    ['null', null],
  ])('refuses %s', (_label, candidate) => {
    expect(validElement(candidate)).toBe(false);
  });

  it('refuses a version far beyond what we hold', () => {
    // Otherwise one crafted element is unmovable and undeletable on every peer, for ever.
    expect(validElement(el({ id: 'a', version: 2 ** 31 }), 5)).toBe(false);
    expect(validElement(el({ id: 'a', version: 5 + MAX_VERSION_JUMP }), 5)).toBe(true);
    expect(validElement(el({ id: 'a', version: 6 + MAX_VERSION_JUMP }), 5)).toBe(false);
  });

  it('refuses an element carrying prototype-pollution keys', () => {
    const nasty = JSON.parse('{"id":"a","version":1,"versionNonce":1,"updated":1,"type":"rectangle","__proto__":{"polluted":true}}');
    expect(validElement(nasty)).toBe(false);
  });

  it('refuses an element larger than the per-element ceiling', () => {
    expect(validElement(el({ id: 'a', junk: 'x'.repeat(300 * 1024) }))).toBe(false);
  });
});
