/**
 * The rule for a client's portal address.
 *
 * `duce` becomes `duce.finsera.nl`, so this is a DNS label, and a DNS label is stricter than
 * an identifier: lowercase, digits, hyphens, no leading or trailing hyphen, at most 63
 * characters. Sixty-three is the wire limit; forty is the limit here because nobody types a
 * forty-character hostname twice.
 *
 * Shared between the API (which enforces it) and the internal app (which shows the rule
 * while somebody is typing), because a rule with two spellings is two rules.
 */
export const PORTAL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/**
 * Names a client may not have, because something else answers to them — or will.
 *
 * `hub` is the internal app and `www` is the marketing site; a client given either would
 * be handed a hostname that already resolves somewhere else. The rest are names that
 * conventionally mean infrastructure and would be confusing on a certificate even when
 * nothing is behind them. Kept as a list rather than a regex so adding one is a one-line
 * diff that reads as what it is.
 */
export const PORTAL_RESERVED_SLUGS: readonly string[] = [
  'hub',
  'www',
  'portal',
  'api',
  'app',
  'mail',
  'smtp',
  'imap',
  'admin',
  'auth',
  'login',
  'static',
  'cdn',
  'status',
  'dev',
  'test',
  'staging',
  'finsera',
];

/** Why a slug is refused, or null when it is fine. Written for the person typing it. */
export function portalSlugProblem(slug: string): string | null {
  if (!PORTAL_SLUG_PATTERN.test(slug)) {
    return 'Use 2–40 lowercase letters, digits or hyphens, starting and ending with a letter or digit';
  }
  if (PORTAL_RESERVED_SLUGS.includes(slug)) return `'${slug}' is reserved`;
  return null;
}
