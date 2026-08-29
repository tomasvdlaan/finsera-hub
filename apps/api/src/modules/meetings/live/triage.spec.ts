import { describe, expect, it } from 'vitest';
import { triage, worthReading } from './triage.js';

describe('triage', () => {
  it('is not fooled by the question mark in small talk', () => {
    // The passage does contain a signal — it ends in a question — and that must not be
    // enough on its own, or every "hoe gaat het?" costs a model call.
    const { score } = triage('Ja precies. Hoe was je weekend? Prima hoor, lekker weer gehad.');
    expect(worthReading('Hoe was je weekend?', 'balanced').worth).toBe(false);
    expect(score).toBeLessThan(1 / 3);
  });

  it('sees a Dutch commitment', () => {
    expect(triage('Ik stuur de dataset morgen door.').signals).toContain('commitment');
  });

  it('sees an English one', () => {
    expect(triage("I'll send the contract over this afternoon.").signals).toContain('commitment');
  });

  it('sees figures, deadlines and decisions', () => {
    const { signals } = triage('Afgesproken: we doen 40 uur, uiterlijk vrijdag klaar.');
    expect(signals).toEqual(expect.arrayContaining(['decision', 'deadline', 'figure']));
  });

  it('wants more evidence when reserved than when eager', () => {
    // One middling signal: enough for an eager agent to look, not for a reserved one.
    const passage = 'Dat kost ongeveer 20 uur denk ik.';
    expect(worthReading(passage, 'eager').worth).toBe(true);
    expect(worthReading(passage, 'reserved').worth).toBe(false);
  });

  it('lets a dense passage through at every level', () => {
    const passage = 'Ik regel de licenties, €4.500 per jaar, uiterlijk 12-09. Akkoord?';
    for (const level of ['reserved', 'balanced', 'eager'] as const) {
      expect(worthReading(passage, level).worth).toBe(true);
    }
  });
});
