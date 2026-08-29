/**
 * Is this stretch of talk worth a model at all?
 *
 * The behaviours used to decide that on volume alone: 800 new characters trips the note-taker
 * whether they were a decision about next quarter's budget or a conversation about parking.
 * Volume is the wrong question — it measures that the meeting is happening, which was never
 * in doubt.
 *
 * So this reads the new text for the marks a consequential passage leaves. Not to understand
 * it — it cannot, and must not try — but to answer the much easier question of whether
 * understanding it is worth a round trip. Being wrong is cheap in one direction and nearly
 * free in the other: a passage wrongly let through costs one call the model will answer with
 * "nothing here", and a passage wrongly held back is picked up on the next pass, because the
 * watermark does not advance when nothing ran.
 *
 * Deliberately not a model. A cheap model in front of an expensive one is two calls whenever
 * it says yes, and the whole point is to spend nothing on the passages that do not matter.
 *
 * Bilingual because the meetings are. A Dutch commitment that only an English pattern could
 * see would make the gate systematically deaf to exactly the meetings it runs in.
 */

/**
 * The marks worth looking for, and why each is here.
 *
 * Grouped rather than pooled, because three hits on three different signals is a much better
 * sign than three hits on the same one — a passage full of numbers is a passage about
 * numbers, which is a single fact about it however many times it repeats.
 */
const SIGNALS: Array<{ name: string; weight: number; pattern: RegExp }> = [
  {
    // Somebody taking something on. The single strongest sign, in either language.
    name: 'commitment',
    weight: 2,
    pattern:
      /\b(i'?ll|we'?ll|i will|we will|i'?m going to|ik ga|wij gaan|we gaan|ik zal|ik doe|ik pak|ik stuur|ik regel|ik zorg|jij pakt|zorg ik|neem ik)\b/i,
  },
  {
    // Something settled. Distinct from a commitment: a decision may have no owner at all.
    name: 'decision',
    weight: 2,
    pattern:
      /\b(let'?s|we should|we agreed|decided|agreed|afgesproken|besloten|we doen|dan doen we|akkoord|prima zo|dat wordt het)\b/i,
  },
  {
    // A time something is due. Dates are what turn a wish into a commitment.
    name: 'deadline',
    weight: 1.5,
    pattern:
      /\b(deadline|by (monday|tuesday|wednesday|thursday|friday|next week|the end)|before (monday|tuesday|wednesday|thursday|friday)|uiterlijk|voor (maandag|dinsdag|woensdag|donderdag|vrijdag)|volgende week|eind van de maand|deze week)\b/i,
  },
  {
    // Money and quantities. A figure said aloud is nearly always worth keeping.
    name: 'figure',
    weight: 1,
    pattern: /(€\s?\d|\$\s?\d|\b\d+([.,]\d+)?\s?(k|%|procent|percent|euro|uur|hours?|dagen|days?|weken|weeks?|maanden|months?)\b)/i,
  },
  {
    /*
     * An unanswered question is the other thing a reader needs afterwards — but a question
     * mark is also what "how was your weekend?" ends with, and small talk is full of them.
     * Weighted down to a hint rather than removed: a question next to a figure or a date is
     * worth reading, and on its own it almost never is.
     */
    name: 'question',
    weight: 0.5,
    pattern: /\?/,
  },
  {
    // A calendar date in any of the forms speech-to-text produces.
    name: 'date',
    weight: 1,
    pattern:
      /\b(\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?|\d{1,2} (januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|january|february|march|april|may|june|july|august|september|october|november|december))\b/i,
  },
];

export interface Triage {
  /** Which signals fired, for the log — so a skipped pass can say what it saw. */
  signals: string[];
  /** 0 when the passage looks like small talk, 1 when it is dense with consequence. */
  score: number;
}

/**
 * The weight at which a passage is as interesting as this can tell.
 *
 * Three, so one commitment plus one deadline saturates it and six question marks do not.
 * Weighted rather than counted because the signals are not comparable: somebody saying "ik
 * stuur het morgen" is the thing the agent exists to catch, and a question mark is a
 * punctuation mark.
 */
const SATURATION = 3;

export function triage(text: string): Triage {
  const hits = SIGNALS.filter((s) => s.pattern.test(text));
  const weight = hits.reduce((sum, s) => sum + s.weight, 0);
  return { signals: hits.map((s) => s.name), score: Math.min(weight / SATURATION, 1) };
}

/**
 * Whether a passage clears the bar for one dial.
 *
 * An eager agent runs on anything at all, which is what makes it eager; a reserved one wants
 * two distinct signals before it spends anything. The bar is on the *passage*, not on what
 * the model then concludes about it — those are two independent filters and both are wanted:
 * this one saves the call, the confidence floor saves you from its answer.
 */
const BARS = { reserved: 2 / SATURATION, balanced: 1 / SATURATION, eager: 0.01 } as const;

export function worthReading(text: string, level: keyof typeof BARS): Triage & { worth: boolean } {
  const result = triage(text);
  return { ...result, worth: result.score >= BARS[level] };
}
