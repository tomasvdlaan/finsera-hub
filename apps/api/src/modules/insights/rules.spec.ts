import { describe, expect, it } from 'vitest';
import { RULES } from './rules.js';

const rule = (name: string) => {
  const found = RULES.find((r) => r.name === name);
  if (!found) throw new Error(`No rule named ${name}`);
  return found;
};

/**
 * The severities, tested as pure functions.
 *
 * `toCandidate` takes a row and returns a candidate, so severity is testable without seeding
 * a database — and severity is what decides whether a rule can ever reach the front door.
 */
describe('insight severities', () => {
  it('lets stalled work reach the attention queue', () => {
    // It was 'info', the only rule in the file that was, and the only rule about work rather
    // than money — so the front door's action queue could contain nothing but money. This is
    // the assertion that stops that being reintroduced.
    const fortnight = rule('task_stalled').toCandidate({
      id: crypto.randomUUID(),
      title: 'A task',
      status: 'in_progress',
      days_still: 14,
    });
    expect(fortnight.severity).toBe('attention');
  });

  it('escalates work that has been stuck a month', () => {
    const month = rule('task_stalled').toCandidate({
      id: crypto.randomUUID(),
      title: 'A task',
      status: 'waiting_on_client',
      days_still: 31,
    });
    // A fortnight is a nudge; a month is a decision about whether the work is still happening.
    expect(month.severity).toBe('urgent');
  });

  it('has no rule that can never be seen', () => {
    // Every rule must be able to produce something the front door shows, or it is a rule
    // nobody will ever act on. `info` is not rendered anywhere.
    const unreachable = RULES.filter((r) => {
      const c = r.toCandidate({
        id: crypto.randomUUID(),
        title: 'x',
        status: 'in_progress',
        days_still: 999,
        days_out: 999,
        days_since: 999,
        undecided: 1,
        oldest_days: 999,
        pct: 100,
        days_to_deadline: 0,
        subtotal_cents: 1,
        legal_name: '',
        kvk_number: '',
        vat_number: '',
        iban: '',
      });
      return c.severity !== 'urgent' && c.severity !== 'attention';
    });
    expect(unreachable.map((r) => r.name)).toEqual([]);
  });

  it('ranks an undecided action point by how long it has waited', () => {
    const c = rule('action_item_undecided').toCandidate({
      id: crypto.randomUUID(),
      title: 'Kickoff',
      undecided: 2,
      days_since: 20,
      client_name: 'DocHorse',
    });
    expect(c.severity).toBe('urgent');
    expect(c.subjectType).toBe('meeting');
    // It carries no money, so ranking it on value would bury it under every invoice.
    expect(c.magnitude).toBeGreaterThan(0);
  });
});
