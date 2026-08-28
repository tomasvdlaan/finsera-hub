import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayFraction,
  dayLengthMinutes,
  daysBetween,
  isoDateOf,
  isWithin,
  shiftDay,
  startOfDay,
  toIsoDate,
  weekDays,
  weekStart,
} from './dates.js';

describe('toIsoDate', () => {
  it('names the local day, not the UTC one', () => {
    // 23:30 local on the 10th. `toISOString().slice(0,10)` — the idiom used elsewhere in the
    // app — reports the 11th anywhere west of UTC and is what this function exists to avoid.
    expect(toIsoDate(new Date(2026, 5, 10, 23, 30))).toBe('2026-06-10');
    expect(toIsoDate(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});

describe('shiftDay', () => {
  it('moves whole calendar days', () => {
    expect(shiftDay('2026-06-10', 1)).toBe('2026-06-11');
    expect(shiftDay('2026-06-10', -1)).toBe('2026-06-09');
    expect(shiftDay('2026-06-10', 0)).toBe('2026-06-10');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDay('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap day', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2028-02-29', 1)).toBe('2028-03-01');
  });
});

describe('weekStart / weekDays', () => {
  it('starts the week on Monday', () => {
    // 2026-06-10 is a Wednesday.
    expect(weekStart('2026-06-10')).toBe('2026-06-08');
    // A Monday is its own week start, and a Sunday belongs to the week that opened six days ago.
    expect(weekStart('2026-06-08')).toBe('2026-06-08');
    expect(weekStart('2026-06-14')).toBe('2026-06-08');
  });

  it('gives seven consecutive days', () => {
    expect(weekDays('2026-06-08')).toEqual([
      '2026-06-08',
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
    ]);
  });
});

describe('daysBetween', () => {
  it('counts calendar days, signed', () => {
    expect(daysBetween('2026-06-08', '2026-06-12')).toBe(4);
    expect(daysBetween('2026-06-12', '2026-06-08')).toBe(-4);
    expect(daysBetween('2026-06-08', '2026-06-08')).toBe(0);
  });
});

describe('isWithin', () => {
  it('is inclusive at both ends', () => {
    expect(isWithin('2026-06-08', '2026-06-08', '2026-06-12')).toBe(true);
    expect(isWithin('2026-06-12', '2026-06-08', '2026-06-12')).toBe(true);
    expect(isWithin('2026-06-07', '2026-06-08', '2026-06-12')).toBe(false);
  });
});

describe('isoDateOf', () => {
  it('reads the local day out of an instant', () => {
    expect(isoDateOf(new Date(2026, 5, 10, 14, 0))).toBe('2026-06-10');
  });
});

describe('dayFraction', () => {
  it('places noon halfway through an ordinary day', () => {
    expect(dayFraction(new Date(2026, 5, 10, 12, 0), '2026-06-10')).toBeCloseTo(0.5, 5);
    expect(dayFraction(new Date(2026, 5, 10, 0, 0), '2026-06-10')).toBeCloseTo(0, 5);
    expect(dayFraction(new Date(2026, 5, 10, 18, 0), '2026-06-10')).toBeCloseTo(0.75, 5);
  });

  it('reports outside 0..1 for an instant on another day, rather than clamping', () => {
    // A meeting running past midnight has to be drawable as overflowing; a function that
    // clamped here could not tell the caller which end went over.
    expect(dayFraction(new Date(2026, 5, 11, 0, 30), '2026-06-10')).toBeGreaterThan(1);
    expect(dayFraction(new Date(2026, 5, 9, 23, 0), '2026-06-10')).toBeLessThan(0);
  });
});

/**
 * The reason this file exists rather than a handful of `+ 86_400_000`.
 *
 * Amsterdam because that is where this is used, and because both transitions land on a Sunday
 * — which in a Monday-first week grid is the last column, the one nobody looks at while
 * developing and everybody looks at on the day it is wrong.
 */
describe('daylight saving', () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Amsterdam';
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it('measures a 23-hour day when the clocks go forward', () => {
    expect(dayLengthMinutes('2026-03-29')).toBe(23 * 60);
  });

  it('measures a 25-hour day when the clocks go back', () => {
    expect(dayLengthMinutes('2026-10-25')).toBe(25 * 60);
  });

  it('measures 1440 on every other day', () => {
    expect(dayLengthMinutes('2026-06-10')).toBe(1440);
    expect(dayLengthMinutes('2026-03-28')).toBe(1440);
    expect(dayLengthMinutes('2026-10-26')).toBe(1440);
  });

  it('still lands 14:00 at 14:00 on a short day', () => {
    // The whole point. On a 1440-assumption the fraction comes out at 0.583 and everything
    // after the transition is drawn an hour out of place.
    const fraction = dayFraction(new Date(2026, 2, 29, 14, 0), '2026-03-29');
    // 14:00 local is 13 hours after midnight on a day that lost an hour at 02:00.
    expect(fraction).toBeCloseTo(13 / 23, 5);
  });

  it('keeps shiftDay on calendar days across a transition', () => {
    expect(shiftDay('2026-03-28', 1)).toBe('2026-03-29');
    expect(shiftDay('2026-03-29', 1)).toBe('2026-03-30');
    expect(startOfDay('2026-03-30').getHours()).toBe(0);
  });
});
