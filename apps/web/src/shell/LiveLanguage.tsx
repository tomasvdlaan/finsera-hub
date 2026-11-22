/**
 * Which language a meeting is spoken in, chosen before recording starts.
 *
 * Without it the transcriber guesses per short audio segment and a Dutch meeting comes back
 * with lines in other languages. The choice is remembered per browser, because a person
 * mostly holds meetings in one language and should not have to say so every time.
 */
export const LIVE_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'nl', label: 'Nederlands' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'auto', label: 'Automatisch (gemengd)' },
];

const KEY = 'finsera.live.language';

export function getLiveLanguage(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && LIVE_LANGUAGES.some((l) => l.code === stored)) return stored;
  } catch {
    /* storage unavailable: fall through to the default */
  }
  return 'nl';
}

export function setLiveLanguage(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* remembering is a convenience, not a requirement */
  }
}

export function LanguageSelect({
  value,
  onChange,
  style,
}: {
  value: string;
  onChange: (code: string) => void;
  style?: React.CSSProperties;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        setLiveLanguage(e.target.value);
        onChange(e.target.value);
      }}
      aria-label="Gesproken taal"
      title="Gesproken taal"
      style={style}
    >
      {LIVE_LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
