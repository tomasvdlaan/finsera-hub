import { describe, expect, it } from 'vitest';
import { formatDuration, formatSpan, parseDuration, resolveTimes, spansMidnight, toLocalInput } from './duration.js';

/**
 * Every hour logged goes through this parser. Being told your input is wrong is slower
 * than any keystroke saved, so it accepts every plausible way of typing a duration.
 */
describe('parseDuration', () => {
  it('reads a bare number as hours', () => {
    expect(parseDuration('8')).toBe(480);
    expect(parseDuration('7.5')).toBe(450);
    expect(parseDuration('0.25')).toBe(15);
  });

  it('accepts a comma decimal, as Dutch keyboards produce', () => {
    expect(parseDuration('7,5')).toBe(450);
  });

  it('reads clock notation', () => {
    expect(parseDuration('7:30')).toBe(450);
    expect(parseDuration('0:45')).toBe(45);
    expect(parseDuration('12:05')).toBe(725);
  });

  it('reads explicit units', () => {
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1h30')).toBe(90);
  });

  it('treats empty input as zero, which clears the cell', () => {
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('   ')).toBe(0);
  });

  it('tolerates surrounding whitespace and case', () => {
    expect(parseDuration('  7,5  ')).toBe(450);
    expect(parseDuration('90M')).toBe(90);
  });

  it('rejects nonsense rather than guessing', () => {
    // Silently storing a wrong number is worse than asking again.
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('-3')).toBeNull();
  });

  it('rounds to whole minutes', () => {
    // Minutes are the stored unit; a third of an hour is 20 minutes exactly.
    expect(parseDuration('0.333')).toBe(20);
  });
});

describe('formatDuration', () => {
  it('renders whole hours without decimals', () => {
    expect(formatDuration(480)).toBe('8');
  });

  it('renders partial hours compactly', () => {
    expect(formatDuration(450)).toBe('7.5');
    expect(formatDuration(15)).toBe('0.25');
  });

  it('renders zero as empty, so the grid shows blanks not noise', () => {
    expect(formatDuration(0)).toBe('');
  });

  it('round-trips through the parser', () => {
    for (const minutes of [15, 30, 90, 450, 480, 725]) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });
});

describe('resolveTimes', () => {
  it('keeps both times on the same day for a normal session', () => {
    const r = resolveTimes('2026-07-27', '09:00', '17:00');
    expect(r.startedAt).toBe('2026-07-27T09:00:00');
    expect(r.endedAt).toBe('2026-07-27T17:00:00');
    expect(r.crossesMidnight).toBe(false);
  });

  it('rolls the end to the next day when the shift crosses midnight', () => {
    // 22:00–02:00 is four hours of work, not a negative duration.
    const r = resolveTimes('2026-07-27', '22:00', '02:00');
    expect(r.startedAt).toBe('2026-07-27T22:00:00');
    expect(r.endedAt).toBe('2026-07-28T02:00:00');
    expect(r.crossesMidnight).toBe(true);
  });

  it('treats an identical start and end as a full 24 hours, not zero', () => {
    const r = resolveTimes('2026-07-27', '09:00', '09:00');
    expect(r.endedAt).toBe('2026-07-28T09:00:00');
  });

  it('leaves the end open for a running timer', () => {
    const r = resolveTimes('2026-07-27', '22:00', '');
    expect(r.startedAt).toBe('2026-07-27T22:00:00');
    expect(r.endedAt).toBeNull();
  });

  it('handles a month boundary', () => {
    const r = resolveTimes('2026-07-31', '23:30', '00:30');
    expect(r.endedAt).toBe('2026-08-01T00:30:00');
  });
});

describe('spansMidnight', () => {
  // Compares LOCAL dates on purpose: the badge sits next to clock times that are also
  // rendered in local time, so "+1" must mean what the reader sees. Timestamps here are
  // written without a Z for that reason — a UTC instant can land on a different local day.
  it('detects an entry ending on a later day', () => {
    expect(spansMidnight('2026-07-27T22:00:00', '2026-07-28T02:00:00')).toBe(true);
  });

  it('is false for a same-day entry or a running one', () => {
    expect(spansMidnight('2026-07-27T09:00:00', '2026-07-27T17:00:00')).toBe(false);
    expect(spansMidnight('2026-07-27T22:00:00', null)).toBe(false);
  });
});

describe('formatSpan', () => {
  /*
   * The tracker's unit, as opposed to the invoice's. `formatHours` says 1.5; this says
   * 1h 30m. Both are correct and they are for different readers.
   */
  it('reads as hours and minutes', () => {
    expect(formatSpan(90)).toBe('1h 30m');
    expect(formatSpan(120)).toBe('2h');
    expect(formatSpan(45)).toBe('45m');
  });

  it('shows a zero rather than nothing', () => {
    // formatDuration returns '' here, which on a day total reads as a page that failed.
    expect(formatSpan(0)).toBe('0m');
  });

  it('rounds part-minutes rather than showing them', () => {
    expect(formatSpan(90.4)).toBe('1h 30m');
    expect(formatSpan(-5)).toBe('0m');
  });
});

describe('toLocalInput', () => {
  it('is empty for nothing', () => {
    expect(toLocalInput(null)).toBe('');
  });

  it('round-trips through a datetime-local field without shifting the instant', () => {
    // The trap: a datetime-local input is read as LOCAL time, so handing it a UTC string
    // moves the entry by the offset every time somebody opens it to edit.
    const iso = new Date('2026-07-31T09:30:00Z').toISOString();
    const value = toLocalInput(iso);
    expect(new Date(value).getTime()).toBe(new Date(iso).getTime());
  });

  it('gives a value the input can actually display', () => {
    expect(toLocalInput(new Date('2026-07-31T09:30:00Z').toISOString())).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
  });
});
