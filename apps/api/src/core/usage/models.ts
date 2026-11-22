import { rateFor, perAnswerMicros } from './rates.js';

/**
 * The models an administrator may choose between.
 *
 * ## Why a curated list and not a free-text field
 *
 * Three things have to be true of a model before it can be selected, and none of them can be
 * checked by a person typing a string:
 *
 * 1. **Its provider has a key configured.** Choosing Anthropic on an instance with no
 *    `ANTHROPIC_API_KEY` breaks every AI feature at once, and the failure appears later, in a
 *    meeting, as "the assistant is broken" rather than as a rejected setting.
 * 2. **The rate card can price it.** An unpriced model still works, but silently reports zero
 *    on the costs page — the page would keep drawing bars while the real number drifted away
 *    from it.
 * 3. **It can actually do the job.** An embedding model is not a chat model, and the fast slot
 *    is called on the hot path of a live meeting where a slow model is a worse answer than a
 *    cheaper one.
 *
 * ## Every Google entry here was called before it was listed
 *
 * Not assumed from a model name. `gemini-2.5-flash` was in this list on the strength of it
 * being a well-known id, it appears in Google's own ListModels response, and calling it returns
 * "no longer available to new users" — so it broke the assistant the moment it was selected,
 * which is exactly the failure this list exists to prevent. Listing is not availability.
 * Anything added here should be called once against this deployment's key first.
 *
 * So the list is code, and the API returns it already filtered by what this deployment can do.
 * `MODEL_STRONG` and `MODEL_FAST` remain the escape hatch for anything not listed here —
 * setting one is a deliberate act by somebody with shell access, which is a different level of
 * intent from picking an option out of a dropdown.
 *
 * ## Transcription is not one of these slots
 *
 * Meeting audio used to be transcribed by whatever the FAST slot pointed at, which made an
 * administrator's dropdown the thing that decided whether live meetings worked at all. Two of
 * the options cannot do it: Claude throws `media type: audio/wav` before the request leaves,
 * and a text-only model behind the gateway rejects it on arrival. Either way every utterance
 * failed, one warning at a time, while the meeting looked like it was recording.
 *
 * It is also a decision that was never the dropdown's to make. G3 accepts Recall receiving raw
 * client audio only on the condition that *no further* processor sees the content — "transcribe
 * with Gemini" is a mitigation written into the DPA story, not a preference. Picking a fast
 * model should not be able to reroute a client's meeting to a second processor.
 *
 * So transcription names its own model, through `MODEL_TRANSCRIBE`, and `transcriptionRefusal`
 * below is what holds the line.
 */
export interface ModelChoice {
  /** 'provider:model', exactly as `specFor` returns it. */
  id: string;
  label: string;
  provider: 'anthropic' | 'google' | 'openrouter';
  /** The company whose model it is, for grouping a long list. Set for OpenRouter entries. */
  group?: string;
  /** Which slots this model is offered for. */
  roles: Array<'strong' | 'fast'>;
  /**
   * Whether this model can be handed meeting audio.
   *
   * Set only where it has been called with a WAV and answered. It is not a slot — see the
   * note on transcription above — it is what `transcriptionRefusal` checks a configured
   * value against.
   */
  transcribes?: true;
  /** One line on what it is for — shown beside the option. */
  note: string;
  /**
   * What one typical answer costs, in micro-euros, or null where it cannot be priced.
   *
   * Carried on the option itself so the dropdown can rank by it. A list of forty models with
   * no prices is a list somebody picks the familiar name from.
   */
  perAnswerMicros?: number | null;
}

const CATALOGUE: ModelChoice[] = [
  {
    id: 'google:gemini-3.1-pro-preview',
    transcribes: true,
    label: 'Gemini 3.1 Pro',
    provider: 'google',
    roles: ['strong'],
    note: 'Strongest reasoning, and what this platform runs today. Around ten times Flash Lite.',
  },
  {
    id: 'google:gemini-3.7-flash',
    transcribes: true,
    label: 'Gemini 3.7 Flash',
    provider: 'google',
    roles: ['strong', 'fast'],
    note: 'The newest Flash. A middle option for reasoning, and quick enough for live meetings.',
  },
  {
    id: 'google:gemini-3.6-flash',
    transcribes: true,
    label: 'Gemini 3.6 Flash',
    provider: 'google',
    roles: ['strong', 'fast'],
    note: 'The previous Flash, kept as a fallback if 3.7 behaves differently on your prompts.',
  },
  {
    id: 'google:gemini-3.1-flash-lite',
    transcribes: true,
    label: 'Gemini 3.1 Flash Lite',
    provider: 'google',
    roles: ['fast'],
    note: 'The cheapest option, and what the fast slot runs today.',
  },
  {
    id: 'anthropic:claude-opus-4-8',
    label: 'Claude Opus 4.8',
    provider: 'anthropic',
    roles: ['strong'],
    note: 'The most capable option, and the most expensive.',
  },
  {
    id: 'anthropic:claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    roles: ['strong'],
    note: 'Close to Opus on most work, materially cheaper.',
  },
  {
    id: 'anthropic:claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    roles: ['fast'],
    note: 'Cheap and quick — the extraction and wake-word path.',
  },
];

/** Whether this deployment holds a key for a provider. */
export function providerConfigured(provider: ModelChoice['provider']): boolean {
  // Deliberately truthiness, not `!== undefined`: an unused key is typically present but
  // empty in .env, and an empty string is a missing key that would fail at the first call.
  return provider === 'anthropic'
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

/**
 * The models this deployment can actually offer, for one slot.
 *
 * Filtered rather than annotated: an option that is shown and cannot be chosen is a support
 * question, and the reason it is unavailable ("no key for that provider") is infrastructure
 * the reader cannot act on from this screen anyway.
 */
export function availableModels(role: 'strong' | 'fast'): ModelChoice[] {
  return CATALOGUE.filter(
    (m) => m.roles.includes(role) && providerConfigured(m.provider) && rateFor(m.id) !== null,
  ).map((m) => {
    const r = rateFor(m.id);
    return { ...m, perAnswerMicros: r ? perAnswerMicros(r) : null };
  });
}

/** Whether a string names a model this deployment is willing to be set to. */
export function isSelectable(id: string, role: 'strong' | 'fast'): boolean {
  return availableModels(role).some((m) => m.id === id);
}

/**
 * What transcription runs on, unless the environment says otherwise.
 *
 * The cheapest Gemini, which is also what the fast slot used to point at on a healthy
 * deployment — so a correctly configured instance behaves exactly as it did before
 * transcription was given its own setting.
 */
export const DEFAULT_TRANSCRIBE_MODEL = 'google:gemini-3.1-flash-lite';

/** The configured transcription model: `MODEL_TRANSCRIBE`, or the Gemini default. */
export function transcriptionSpec(): string {
  const set = process.env.MODEL_TRANSCRIBE?.trim();
  return set && set.length > 0 ? set : DEFAULT_TRANSCRIBE_MODEL;
}

/**
 * Why this deployment cannot transcribe, in a sentence somebody can act on — or null when it
 * can.
 *
 * One function, three callers: the guard inside the only audio call there is, and the two
 * places a recording starts. That shape is deliberate. The old failure was discovered one
 * utterance at a time, after the bot had joined a client's meeting, as a `warn` nobody reads;
 * the same facts are knowable before anybody presses record, so this is written to be asked
 * early and answered in full.
 *
 * The provider rule is a policy rule and not a capability one. Anthropic genuinely cannot take
 * audio, but a gateway model might — and routing client meeting audio through OpenRouter is
 * the thing D6 refused for text and G3 called out as worse for audio. It is refused here
 * rather than left to whoever sets the variable, because the whole point of G3's mitigation is
 * that it holds without anybody remembering it.
 */
export function transcriptionRefusal(spec = transcriptionSpec()): string | null {
  const [provider = ''] = spec.split(':');

  if (provider !== 'google') {
    return (
      `Transcription is set to '${spec}', and meeting audio only goes to Gemini — see G3 in ` +
      `the decision log, which accepts the capture processor on condition that nothing else ` +
      `sees the content. Set MODEL_TRANSCRIBE to a Gemini model.`
    );
  }

  if (!providerConfigured('google')) {
    return (
      'GOOGLE_GENERATIVE_AI_API_KEY is not set, so meeting audio cannot be transcribed. ' +
      'Recording would capture a meeting and produce no words.'
    );
  }

  /*
   * An unlisted Gemini is allowed through with a warning rather than refused.
   *
   * Setting this variable takes shell access, which models.ts already treats as a different
   * level of intent from choosing an option — and a new Gemini should not need a deploy of
   * this file. The provider is the part that carries the data-protection promise, and that
   * part has been checked above.
   */
  return null;
}

/** Whether a configured transcription model is one this file has actually seen work. */
export function isKnownTranscriber(spec = transcriptionSpec()): boolean {
  return CATALOGUE.some((m) => m.id === spec && m.transcribes === true);
}
