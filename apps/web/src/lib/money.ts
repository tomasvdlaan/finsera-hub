/**
 * Euros in, cents stored.
 *
 * Money is integer cents everywhere in this platform, and every field a person types into
 * should take euros — the conversion is the app's job, not the reader's. This existed twice
 * already, defined inside `ProjectDetail` and again inside `Money`, and the one screen that
 * had neither asked for raw cents: a quote's hourly rate was labelled "(cents)" and copied
 * onto the project on acceptance, so a single missing zero signed off a €13.50 engagement.
 *
 * Kept in `lib/` rather than a component so the next money field cannot quietly invent a
 * third convention.
 */

/** Cents to a fixed two-decimal string for an input. Null passes through as empty. */
export const euros = (cents: number | null | undefined): string | null =>
  cents == null ? null : (cents / 100).toFixed(2);

/**
 * A typed amount to whole cents.
 *
 * Accepts a comma as the decimal separator, because this is a Dutch business and `12,50` is
 * what a Dutch keyboard produces. Anything that is not a finite number becomes null rather
 * than NaN — a field left in a broken state should clear, not store nonsense.
 */
export const cents = (value: string | null | undefined): number | null => {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};
