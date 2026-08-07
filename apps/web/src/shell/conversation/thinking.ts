/**
 * One line of "what it is doing", pulled out of the model's working-out.
 *
 * Gemini's thought summaries arrive as a bold heading followed by a paragraph — "**Defining
 * the Project Scope**\n\nOkay, I'm starting to zero in on…" — repeating as it moves on. The
 * heading is already the summary, so the live line is the most recent one and the prose stays
 * behind a disclosure for anybody who wants it.
 *
 * Falls back to the last sentence when there is no heading, because a provider that formats
 * its thoughts differently should still show something rather than nothing. Returns null only
 * when there is genuinely nothing yet, which is the caret's job to cover.
 */
export function latestThought(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;

  const headings = [...raw.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]!.trim()).filter(Boolean);
  if (headings.length > 0) return tidy(headings[headings.length - 1]!);

  /*
   * No heading, so the last complete sentence — and only a complete one.
   *
   * The trailing fragment is mid-generation and changes character by character; showing it
   * makes the line flicker like a slot machine, which reads as broken rather than as busy.
   */
  const sentences = raw
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const complete = sentences.filter((x) => /[.!?]$/.test(x));
  const pick = complete.length > 0 ? complete[complete.length - 1]! : sentences[0];
  return pick ? tidy(pick) : null;
}

/** Trim to something that fits on one line without a scrollbar or a hyphenation argument. */
function tidy(text: string): string {
  const clean = text.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > 90 ? `${clean.slice(0, 89).trimEnd()}…` : clean;
}
