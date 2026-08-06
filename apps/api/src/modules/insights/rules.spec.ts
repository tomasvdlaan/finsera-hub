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
  it('lets aging work reach the attention queue', () => {
    // It was 'info', the only rule in the file that was, and the only rule about work rather
    // than money — so the front door's action queue could contain nothing but money. This is
    // the assertion that stops that being reintroduced.
    const fortnight = rule('task_aging_wip').toCandidate({
      id: crypto.randomUUID(),
      title: 'A task',
      status: 'in_progress',
      current_flow: 'active',
      has_history: true,
      days_in_flight: 14,
    });
    expect(fortnight.severity).toBe('attention');
  });

  it('says "at most" for a card whose age is inferred rather than measured', () => {
    // Cards created before the transitions table have no start to measure from, so the age is
    // bounded by when they were made. Printing that as a measurement would be a small lie.
    const inferred = rule('task_aging_wip').toCandidate({
      id: crypto.randomUUID(),
      title: 'Older than the table',
      status: 'in_progress',
      current_flow: 'active',
      has_history: false,
      days_in_flight: 20,
    });
    expect(inferred.title).toMatch(/in flight at most 20 days/);
  });

  it('lets a blocker reach the attention queue quickly', () => {
    const candidate = rule('task_blocked').toCandidate({
      id: crypto.randomUUID(),
      title: 'Ship the SOC2 endpoint',
      status: 'in_progress',
      days_blocked: 3,
      project_name: 'Power BI',
    });

    // Faster than aging work's fortnight on purpose. An old card might just be big; a blocker
    // is a thing somebody wrote down as being in the way, so somebody already knows what
    // needs to happen.
    expect(candidate.severity).toBe('attention');
    expect(candidate.subjectType).toBe('task');
    expect(candidate.title).toMatch(/blocked for 3 days/);
  });

  it('escalates a blocker nobody cleared in a week', () => {
    const candidate = rule('task_blocked').toCandidate({
      id: crypto.randomUUID(),
      title: 'Ship the SOC2 endpoint',
      status: 'review',
      days_blocked: 9,
      project_name: null,
    });
    expect(candidate.severity).toBe('urgent');
  });

  it('escalates work that has been in flight a month', () => {
    const month = rule('task_aging_wip').toCandidate({
      id: crypto.randomUUID(),
      title: 'A task',
      status: 'waiting_on_client',
      current_flow: 'waiting',
      has_history: true,
      days_in_flight: 31,
    });
    // A fortnight is a nudge; a month is a decision about whether the work is still happening.
    expect(month.severity).toBe('urgent');
  });

  it('turns a sprint ending with work open into something you are told', () => {
    // The first thing that has ever read scrum.v_sprints, which has been created on every
    // boot since the module shipped and queried by exactly one test.
    const friday = rule('sprint_ending_soon_with_open_work').toCandidate({
      id: crypto.randomUUID(),
      name: 'Sprint 4',
      ends_on: '2026-08-14',
      task_count: 9,
      done_count: 4,
      days_left: 0,
      open_count: 5,
      project_name: 'Power BI',
    });
    expect(friday.severity).toBe('urgent');
    expect(friday.subjectType).toBe('sprint');
    expect(friday.title).toMatch(/ends today with 5 open/);
  });

  it('names the client sitting on work', () => {
    // "We are blocked on them" becomes evidence when a deadline slips, which is the whole
    // reason waiting-on-client is a default column.
    const waiting = rule('waiting_on_client_too_long').toCandidate({
      id: crypto.randomUUID(),
      title: 'Supplier page',
      days_waiting: 9,
      project_name: 'Power BI',
      client_name: 'DocHorse',
    });
    expect(waiting.title).toMatch(/DocHorse has had "Supplier page" for 9 days/);
    expect(waiting.severity).toBe('attention');
  });

  it('tells you a task is past its due date, which nothing ever did', () => {
    const overdue = rule('task_overdue').toCandidate({
      id: crypto.randomUUID(),
      title: 'Model the spend dataset',
      status: 'in_progress',
      due_on: '2026-07-30',
      days_over: 7,
      project_name: 'Power BI',
    });
    expect(overdue.severity).toBe('urgent');
    expect(overdue.title).toMatch(/was due 7 days ago/);
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
