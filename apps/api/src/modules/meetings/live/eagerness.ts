/**
 * How forward the meeting agent is, per kind of consequence.
 *
 * Three dials rather than one, because the three things the agent can do cost wildly
 * different amounts when it is wrong. Editing its own notes is cheap and reversible.
 * Creating an action point puts work on a person, who then has to work out whether they
 * really agreed to it. Speaking aloud interrupts a room that may contain a client. A
 * single slider that made it freer with the document *and* chattier in front of the
 * client would be the wrong shape — which the platform already half knew, since
 * `maySpeak` has always been a separate switch from `enabled`.
 *
 * Each dial drives three mechanisms, and they are deliberately not the same mechanism:
 *
 *   1. Prompt language, injected into every behaviour from one place here rather than
 *      restated in five system prompts that then drift.
 *   2. Pace — how often the behaviour bothers to run at all. A reserved agent should
 *      not merely propose less, it should think less often.
 *   3. A confidence floor applied in code to whatever the model returns.
 *
 * The third is the one that actually holds. Prompt wording is a request; a numeric filter
 * is not, and it survives a model swap that quietly reinterprets the adjectives. It is also
 * the only one of the three that produces a number you can calibrate later against the
 * accept and dismiss decisions `decideProposal` already records.
 */

export const EAGERNESS_LEVELS = ['reserved', 'balanced', 'eager'] as const;
export type EagernessLevel = (typeof EAGERNESS_LEVELS)[number];

/** The three consequence classes. */
export const EAGERNESS_DIALS = ['notes', 'actions', 'speech'] as const;
export type EagernessDial = (typeof EAGERNESS_DIALS)[number];

export type Eagerness = Record<EagernessDial, EagernessLevel>;

/**
 * What the agent does before anybody has an opinion.
 *
 * Notes balanced, the other two reserved. Writing in the document is the thing the agent is
 * for and the thing you can undo by deleting a line; proposing work and talking out loud are
 * the two that are embarrassing to get wrong in front of a client, so they start shy.
 */
export const DEFAULT_EAGERNESS: Eagerness = {
  notes: 'balanced',
  actions: 'reserved',
  speech: 'reserved',
};

/**
 * The floor a model's own confidence must clear.
 *
 * Asymmetric on purpose: the step from reserved to balanced is much larger than the step
 * from balanced to eager, because the useful range of a model's self-reported confidence is
 * bunched at the top. A floor of 0.5 is not "half sure", it is "said anything at all".
 */
const FLOORS: Record<EagernessLevel, number> = {
  reserved: 0.8,
  balanced: 0.55,
  eager: 0.3,
};

export const confidenceFloor = (level: EagernessLevel): number => FLOORS[level];

/**
 * How much to stretch an interval or a threshold.
 *
 * Multiplies the behaviour's own constants rather than replacing them, so each behaviour
 * keeps its own sense of its natural pace — agenda drift is four minutes because that is how
 * long a digression needs to run before it counts as one, and reserving it should make it
 * six minutes rather than some number this file invented.
 */
const PACE: Record<EagernessLevel, number> = {
  reserved: 1.5,
  balanced: 1,
  eager: 0.6,
};

export const pace = (level: EagernessLevel, base: number): number =>
  Math.round(base * PACE[level]);

/**
 * The line every behaviour puts in its system prompt.
 *
 * Written as a threshold on evidence rather than as a personality. "Be conservative" is
 * advice a model can agree with and then ignore; "only if somebody said it in as many words"
 * is a test it can apply to a specific sentence. The confidence sentence is the same in all
 * three because the floor, not the wording, is what enforces it — the model only needs to
 * know the number means something.
 */
const GUIDANCE: Record<EagernessDial, Record<EagernessLevel, string>> = {
  notes: {
    reserved:
      'Record only what a reader would be misled by not knowing: decisions, figures, dates, commitments. Leave everything else out. Most passes should change nothing.',
    balanced:
      'Record what someone reading this next week would need. Prefer a short accurate note to a complete one.',
    eager:
      'Record generously — points raised, context given, anything a reader might want. It is easier to delete a line than to remember one.',
  },
  actions: {
    reserved:
      'Propose an action only when somebody said, in as many words, that they would do a specific thing. No inferred owners, no implied deadlines, nothing that merely sounds like a commitment.',
    balanced:
      'Propose an action when the room clearly agreed somebody would do something, even if the wording was loose.',
    eager:
      'Propose an action for anything that sounds like work somebody has taken on, including things left half-stated.',
  },
  speech: {
    reserved:
      'Speak only if staying silent would let the meeting miss something it called itself to do. Silence is almost always right.',
    balanced: 'Speak when you have something the room needs now and would not otherwise get.',
    eager: 'Speak whenever you can usefully add to what is being discussed.',
  },
};

/** The prompt fragment for one dial, as lines ready to splice into a system prompt. */
export function guidance(dial: EagernessDial, level: EagernessLevel): string {
  return [
    `HOW FORWARD TO BE (${dial}: ${level}):`,
    GUIDANCE[dial][level],
    `Give each item a confidence between 0 and 1 — your honest odds that it is right and worth recording. Anything below ${FLOORS[level].toFixed(2)} will be discarded, so a low number is a real answer and not a failure.`,
  ].join('\n');
}

/** Keep only what clears the floor. The half of the dial that does not depend on wording. */
export function clearing<T extends { confidence?: number }>(
  items: readonly T[],
  level: EagernessLevel,
): T[] {
  const floor = FLOORS[level];
  // An item with no confidence at all is kept: a model that ignored the field should not
  // silently empty the meeting's notes, and that failure would look exactly like a quiet one.
  return items.filter((item) => (item.confidence ?? 1) >= floor);
}

/** Narrow whatever arrived over the wire, falling back per dial rather than wholesale. */
export function readEagerness(value: unknown, fallback: Eagerness = DEFAULT_EAGERNESS): Eagerness {
  const raw = (value ?? {}) as Partial<Record<EagernessDial, unknown>>;
  const level = (dial: EagernessDial): EagernessLevel => {
    const found = raw[dial];
    return EAGERNESS_LEVELS.includes(found as EagernessLevel)
      ? (found as EagernessLevel)
      : fallback[dial];
  };
  return { notes: level('notes'), actions: level('actions'), speech: level('speech') };
}
