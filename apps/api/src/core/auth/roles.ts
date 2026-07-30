import type { JWTPayload } from 'jose';

/**
 * Project roles out of a Zitadel token.
 *
 * Why roles carry the separation rather than the audience: **a client may request an
 * arbitrary audience scope and receive a token containing it, without holding any grant
 * for that audience** (`urn:zitadel:iam:org:project:id:{projectID}:aud`). Offline JWKS
 * validation cannot detect that — the signature is genuine, the `aud` is simply not
 * evidence of authorisation. Zitadel's own guidance is to "always verify specific roles,
 * scopes or custom claims in addition to checking the aud claim".
 *
 * Roles are different in kind. They are written into the token from server-side grants,
 * so a client cannot ask for one it has not been given, and an offline check of a role is
 * therefore an authorisation decision rather than a restatement of the request.
 *
 * The claim shape is `{ "role_key": { "orgId": "org.domain" } }`.
 */
export const INTERNAL_ROLE = process.env.ZITADEL_INTERNAL_ROLE ?? 'internal';
export const PORTAL_ROLE = process.env.ZITADEL_PORTAL_ROLE ?? 'portal_client';

/** Any project-scoped roles claim: `urn:zitadel:iam:org:project:{projectId}:roles`. */
const SCOPED = /^urn:zitadel:iam:org:project:([^:]+):roles$/;
/** The legacy, unscoped spelling. */
const FLAT = 'urn:zitadel:iam:org:project:roles';

/** Every roles claim in a claim bag, by claim name. Exported for the diagnostics route. */
export function roleClaims(claims: Record<string, unknown>): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(claims)) {
    if ((name === FLAT || SCOPED.test(name)) && value && typeof value === 'object') {
      found[name] = Object.keys(value as object);
    }
  }
  return found;
}

/**
 * Project roles out of a claim bag.
 *
 * Reads a plain record rather than only a JWT, because on this instance the access token
 * carries nothing but the standard eight claims — roles arrive from the userinfo endpoint
 * instead, and that is a server-to-server call to the issuer authenticated with the access
 * token, so its answer is exactly as trustworthy as a claim inside the token. One
 * implementation for both, or the two checks drift.
 *
 * When ZITADEL_PROJECT_ID is set it is the only scoped claim that counts, and a scoped
 * claim for a different project is ignored — importing another project's grants would be
 * importing somebody else's authorisation decisions.
 *
 * When it is NOT set, a single scoped claim is accepted whatever project it names. Zitadel
 * Cloud emits the scoped form, so the strict reading finds nothing and locks out every
 * user, which is how this instance behaves today. One claim on a one-project instance is
 * unambiguous; two are not, and are refused rather than guessed between. Setting
 * ZITADEL_PROJECT_ID turns this from an inference into a check, and the diagnostics route
 * reports which claim answered so it can be set correctly.
 */
export function rolesFrom(claims: JWTPayload | Record<string, unknown>): string[] {
  const bag = claims as Record<string, unknown>;
  const projectId = process.env.ZITADEL_PROJECT_ID;
  const all = roleClaims(bag);

  if (projectId) {
    // Configured: the flat claim, or this project's. Nothing else, ever.
    return all[`urn:zitadel:iam:org:project:${projectId}:roles`] ?? all[FLAT] ?? [];
  }
  if (all[FLAT]) return all[FLAT];

  const scoped = Object.entries(all).filter(([name]) => name !== FLAT);
  return scoped.length === 1 ? scoped[0]![1] : [];
}

export const hasRole = (claims: JWTPayload | Record<string, unknown>, role: string): boolean =>
  rolesFrom(claims).includes(role);
