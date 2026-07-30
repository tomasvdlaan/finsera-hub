import { describe, expect, it } from 'vitest';
import { TEMPLATES, TEMPLATE_LIST, bodyFor } from './templates.js';

/**
 * The shape a ceremony starts in.
 *
 * Pure text assembly, and worth testing because the stand-up is the one template whose body
 * depends on who is in the room — the rest is static and cannot be wrong.
 */
describe('bodyFor', () => {
  it('gives every person in the room their own block', () => {
    const body = bodyFor(TEMPLATES.daily_standup, [{ name: 'Tomas' }, { name: 'Anna' }]);

    expect(body).toContain('### Tomas');
    expect(body).toContain('### Anna');
    // A stand-up is several short conversations; the point is a place to stand in each one.
    expect(body.match(/- Blockers:/g)).toHaveLength(2);
    expect(body).toContain('## Sprint goal');
  });

  it('leaves the template alone when nobody is listed yet', () => {
    const body = bodyFor(TEMPLATES.daily_standup, []);
    expect(body).toBe(TEMPLATES.daily_standup.body);
    expect(body).not.toContain('{name}');
  });

  it('does not invent per-person blocks for a ceremony that has none', () => {
    const body = bodyFor(TEMPLATES.sprint_planning, [{ name: 'Tomas' }]);
    expect(body).toBe(TEMPLATES.sprint_planning.body);
    expect(body).not.toContain('### Tomas');
  });

  it('substitutes every occurrence, not just the first', () => {
    const body = bodyFor(
      { ...TEMPLATES.daily_standup, perAttendee: '### {name}\n\n{name} said:\n' },
      [{ name: 'Tomas' }],
    );
    expect(body).not.toContain('{name}');
  });
});

describe('the ceremonies', () => {
  it('covers the SCRUM ceremonies, which were all missing', () => {
    const names = TEMPLATE_LIST.map((t) => t.name);
    expect(names).toContain('daily_standup');
    expect(names).toContain('sprint_planning');
    expect(names).toContain('sprint_review');
    expect(names).toContain('retrospective');
  });

  it('gives every template a timebox, since the room shows elapsed against it', () => {
    // A missing one would silently render as no timebox rather than as an error.
    expect(TEMPLATE_LIST.every((t) => t.timeboxMinutes > 0)).toBe(true);
    expect(TEMPLATES.daily_standup.timeboxMinutes).toBe(15);
  });
});
