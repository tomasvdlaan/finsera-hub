import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EAGERNESS,
  clearing,
  confidenceFloor,
  guidance,
  pace,
  readEagerness,
} from './eagerness.js';

describe('eagerness', () => {
  it('raises the floor as the dial is turned down', () => {
    expect(confidenceFloor('eager')).toBeLessThan(confidenceFloor('balanced'));
    expect(confidenceFloor('balanced')).toBeLessThan(confidenceFloor('reserved'));
  });

  it('keeps only what clears the floor', () => {
    const items = [{ confidence: 0.9 }, { confidence: 0.6 }, { confidence: 0.35 }];
    expect(clearing(items, 'reserved')).toHaveLength(1);
    expect(clearing(items, 'balanced')).toHaveLength(2);
    expect(clearing(items, 'eager')).toHaveLength(3);
  });

  it('keeps an item that reported no confidence at all', () => {
    // A model that ignored the field must not silently empty the meeting's notes — that
    // failure is indistinguishable from a quiet meeting.
    expect(clearing([{}], 'reserved')).toHaveLength(1);
  });

  it('stretches an interval for a reserved dial and shortens it for an eager one', () => {
    expect(pace('reserved', 90_000)).toBeGreaterThan(90_000);
    expect(pace('balanced', 90_000)).toBe(90_000);
    expect(pace('eager', 90_000)).toBeLessThan(90_000);
  });

  it('names the dial, the level and the floor in its guidance', () => {
    const text = guidance('actions', 'reserved');
    expect(text).toContain('actions: reserved');
    expect(text).toContain(confidenceFloor('reserved').toFixed(2));
  });

  it('falls back per dial rather than wholesale', () => {
    // A row written by an older version, or a client that sent one dial. The dials it did
    // send must survive; discarding the object entirely would silently reset the others.
    expect(readEagerness({ notes: 'eager', actions: 'nonsense' })).toEqual({
      ...DEFAULT_EAGERNESS,
      notes: 'eager',
    });
    expect(readEagerness(null)).toEqual(DEFAULT_EAGERNESS);
    expect(readEagerness({ speech: 'eager' }, { notes: 'reserved', actions: 'reserved', speech: 'reserved' })).toEqual(
      { notes: 'reserved', actions: 'reserved', speech: 'eager' },
    );
  });
});
