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

/**
 * Both claim spellings.
 *
 * Zitadel's newer, project-scoped claim replaces the legacy flat one, and which appears
 * depends on instance configuration. Reading both means a working setup is not mistaken
 * for an unauthorised one — a role check that silently finds nothing would lock out every
 * user, which is at least loud, but it would also mask a genuine misconfiguration.
 */
export function rolesFrom(payload: JWTPayload): string[] {
  const projectId = process.env.ZITADEL_PROJECT_ID;
  const candidates = [
    projectId ? `urn:zitadel:iam:org:project:${projectId}:roles` : undefined,
    'urn:zitadel:iam:org:project:roles',
  ].filter((c): c is string => c !== undefined);

  for (const claim of candidates) {
    const value = payload[claim];
    if (value && typeof value === 'object') return Object.keys(value as object);
  }
  return [];
}

export const hasRole = (payload: JWTPayload, role: string): boolean =>
  rolesFrom(payload).includes(role);
