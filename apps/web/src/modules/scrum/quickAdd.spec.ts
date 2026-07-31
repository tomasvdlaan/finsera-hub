import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quickAdd.js';
import type { Person } from './types.js';

const people: Person[] = [
  { id: 'u1', displayName: 'Galang Andika' },
  { id: 'u2', displayName: 'Septin Annisa' },
];

/**
 * The quick-add line.
 *
 * Every case here is a way it could quietly take a word out of somebody's title. That is the
 * failure mode that matters: a wrong priority is visible and fixable, a missing word in a
 * title is neither, and it is only noticed weeks later when nobody can find the card.
 */
describe('parseQuickAdd', () => {
  const parse = (s: string) => parseQuickAdd(s, people);

  it('reads the whole line', () => {
    const r = parse('Fix the login redirect !high @galang #frontend ~2h bug');
    expect(r.title).toBe('Fix the login redirect');
    expect(r.priority).toBe('high');
    expect(r.assigneeId).toBe('u1');
    expect(r.labels).toEqual(['frontend']);
    expect(r.estimateMinutes).toBe(120);
    expect(r.type).toBe('bug');
  });

  it('leaves a plain title alone', () => {
    const r = parse('Model the purchasing spend dataset');
    expect(r.title).toBe('Model the purchasing spend dataset');
    expect(r.priority).toBeUndefined();
    expect(r.type).toBeUndefined();
    expect(r.recognised).toEqual([]);
  });

  it('does not eat a type word from the middle of a sentence', () => {
    // The whole reason the type is only read as the last word.
    const r = parse('Fix the bug in checkout');
    expect(r.title).toBe('Fix the bug in checkout');
    expect(r.type).toBeUndefined();
  });

  it('will not reduce a title to nothing', () => {
    // "bug" alone is a title, not a type with no card attached.
    const r = parse('bug');
    expect(r.title).toBe('bug');
    expect(r.type).toBeUndefined();
  });

  it('keeps an unknown token rather than discarding it', () => {
    const r = parse('Ship it !yesterday @nobody');
    expect(r.title).toBe('Ship it !yesterday @nobody');
    expect(r.priority).toBeUndefined();
    expect(r.assigneeId).toBeUndefined();
  });

  it('matches a person on any word of their name', () => {
    expect(parse('Review copy @annisa').assigneeId).toBe('u2');
    expect(parse('Review copy @septin').assigneeId).toBe('u2');
  });

  it('reads minutes as well as hours, and a decimal comma', () => {
    expect(parse('Standup ~30m').estimateMinutes).toBe(30);
    expect(parse('Spike ~1,5h').estimateMinutes).toBe(90);
  });

  it('ignores a zero estimate rather than storing one the database would refuse', () => {
    const r = parse('Nothing ~0h');
    expect(r.estimateMinutes).toBeUndefined();
    expect(r.title).toBe('Nothing ~0h');
  });

  it('takes several labels', () => {
    expect(parse('Migrate #api #urgent-ish').labels).toEqual(['api', 'urgent-ish']);
  });

  it('does not treat an address or a language as a token', () => {
    const r = parse('Email info@finsera.nl about C#');
    expect(r.title).toBe('Email info@finsera.nl about C#');
    expect(r.assigneeId).toBeUndefined();
    expect(r.labels).toBeUndefined();
  });

  it('says what it recognised, so nothing is taken silently', () => {
    const r = parse('Tidy up !low #chore-ish');
    expect(r.recognised.map((x) => x.token)).toEqual(['!low', '#chore-ish']);
  });
});
