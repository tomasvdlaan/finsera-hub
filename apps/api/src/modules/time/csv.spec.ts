import { describe, expect, it } from 'vitest';
import { csvHours, csvMoney, csvYesNo, toCsv } from './csv.js';

/**
 * The failures worth testing are the silent ones.
 *
 * A CSV that throws is a bug somebody fixes in a minute. A CSV that opens with one row split
 * across three, or an hour parsed as text so the column will not sum, is a bug that reaches a
 * bookkeeper and comes back as a question about the business rather than about the file.
 */
describe('csv', () => {
  it('quotes a value containing the separator, so the row does not split', () => {
    const out = toCsv(['description'], [['Modelling; then review']]);
    expect(out).toContain('"Modelling; then review"');
  });

  it('doubles an inner quote rather than ending the field early', () => {
    const out = toCsv(['description'], [['Called it the "final" dataset']]);
    expect(out).toContain('"Called it the ""final"" dataset"');
  });

  it('quotes a newline, so one entry stays one row', () => {
    const out = toCsv(['description'], [['First line\nSecond line']]);
    expect(out).toContain('"First line\nSecond line"');
    // The row separator is CRLF; a bare LF inside a quoted field must not be mistaken for one.
    expect(out.split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('leads with a BOM, or an accented name arrives mojibaked', () => {
    expect(toCsv(['name'], [['Marieke Bäcker']]).startsWith('\uFEFF')).toBe(true);
  });

  it('separates with a semicolon and ends rows with CRLF', () => {
    const out = toCsv(['a', 'b'], [['1', '2']]);
    expect(out).toBe('\uFEFFa;b\r\n1;2\r\n');
  });

  it('writes an empty cell for nothing, rather than the word null', () => {
    const out = toCsv(['a', 'b', 'c'], [[null, undefined, '']]);
    expect(out).toBe('\uFEFFa;b;c\r\n;;\r\n');
  });

  describe('numbers a Dutch spreadsheet can add up', () => {
    it('writes hours with a comma', () => {
      expect(csvHours(450)).toBe('7,50');
      expect(csvHours(0)).toBe('0,00');
      expect(csvHours(1)).toBe('0,02');
    });

    it('writes money with a comma and no separator or symbol', () => {
      expect(csvMoney(4850)).toBe('48,50');
      expect(csvMoney(1234567)).toBe('12345,67');
      // Absent, not zero: a blank cell says "unknown", a 0 says "free".
      expect(csvMoney(null)).toBe('');
    });

    it('says yes and no in words a reader recognises', () => {
      expect(csvYesNo(true)).toBe('ja');
      expect(csvYesNo(false)).toBe('nee');
    });
  });
});
