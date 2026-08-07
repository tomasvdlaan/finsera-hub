import { describe, expect, it } from 'vitest';
import { MOVED, relocate } from './moved.js';

describe('the old URLs', () => {
  it('carries the rest of the path across', () => {
    expect(relocate('/crm/clients/abc')).toBe('/clients/abc');
    expect(relocate('/scrum/tasks/abc')).toBe('/tasks/abc');
    expect(relocate('/billing/invoices/abc')).toBe('/money/invoices/abc');
  });

  it('recognises the longer prefix first', () => {
    // '/sales' also matches the start of '/sales/contracts'. Order in the table is the only
    // thing keeping a contract off the quotes list.
    expect(relocate('/sales/contracts/abc')).toBe('/money/contracts/abc');
    expect(relocate('/sales')).toBe('/money/quotes');
    expect(relocate('/scrum/sprints/abc')).toBe('/board/sprints/abc');
    expect(relocate('/scrum')).toBe('/board');
  });

  it('leaves an address that never moved alone', () => {
    expect(relocate('/today')).toBeNull();
    expect(relocate('/meetings/abc')).toBeNull();
    // Not a prefix match on '/time/day': the segment has to end.
    expect(relocate('/time/weekly')).toBeNull();
  });

  it('never redirects to something that also redirects', () => {
    for (const [, to] of MOVED) expect(relocate(to), `${to} redirects onward`).toBeNull();
  });
});
