/**
 * Languages a meeting can be pinned to for transcription.
 *
 * Audio arrives as many short, separate segments, and each one used to be transcribed with no
 * idea what language the meeting was in. A two-second "ja, klopt" has very little to go on, so
 * the model guessed per segment — and a Dutch meeting came back with lines in English, German
 * and Afrikaans. Telling it once what is being spoken removes the guess.
 *
 * `null` (the "auto" choice) keeps the old behaviour, for meetings that genuinely switch.
 */
export const TRANSCRIPTION_LANGUAGES = {
  nl: 'Dutch',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
} as const;

export type TranscriptionLanguage = keyof typeof TRANSCRIPTION_LANGUAGES;

/** Anything unrecognised (including 'auto' and empty) means "let the model detect it". */
export function parseLanguage(value: unknown): TranscriptionLanguage | null {
  return typeof value === 'string' && value in TRANSCRIPTION_LANGUAGES
    ? (value as TranscriptionLanguage)
    : null;
}

/** The sentence added to the transcription prompt, or '' when the language is not pinned. */
export function languageInstruction(language: TranscriptionLanguage | null): string {
  if (!language) return '';
  const name = TRANSCRIPTION_LANGUAGES[language];
  return (
    ` The meeting is spoken in ${name}. Transcribe in ${name}, exactly as spoken: never ` +
    `translate, and never guess another language for a short or unclear fragment. ` +
    `Occasional words or names from other languages stay as they were said.`
  );
}
