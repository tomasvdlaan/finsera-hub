import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from './duration.js';

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
