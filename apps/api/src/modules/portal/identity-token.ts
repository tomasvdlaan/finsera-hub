import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { SignJWT, calculateJwkThumbprint, exportJWK, type JWK } from 'jose';

/**
 * Who is looking, handed to the artefact behind the proxy.
 *
 * The proxy has already decided that this person may open the page. An artefact that keeps a
 * worklist or records who changed what needs to know *who* — and the only things it could
 * trust for that are what the Hub tells it, signed. A header the browser could also send
 * is not that, which is why the proxy never forwards a client-supplied one (the upstream
 * request is built from an allow-list) and why the value is a signature the artefact checks
 * against our public key rather than a shared secret it would have to keep.
 *
 * Ed25519 so that the key the artefact needs is public: a JWKS URL, nothing to configure
 * per artefact, nothing to leak from a repository.
 *
 * Sixty seconds, because the token is made per request and used on arrival. A token copied
 * out of a log is worthless a minute later, and there is no refresh to get wrong.
 */
export const IDENTITY_HEADER = 'x-finsera-identity';
export const IDENTITY_TTL_SECONDS = 60;

const DEFAULT_ISSUER = 'https://hub.finsera.nl';

/** What the artefact is told. `aud` is the page's slug: a token for one page is not for another. */
export interface IdentityClaims {
  aud: string;
  sub: string;
  email: string | null;
  name: string | null;
  kind: 'client' | 'staff';
}

export function identityIssuer(): string {
  return (process.env.PORTAL_IDENTITY_ISSUER || DEFAULT_ISSUER).replace(/\/$/, '');
}

interface Loaded {
  source: string;
  privateKey: KeyObject;
  jwk: JWK;
}

let cache: Loaded | null = null;

/**
 * `PORTAL_IDENTITY_KEY`: an Ed25519 private key, PKCS#8 PEM, either as is or base64 of it
 * (an .env line cannot hold a multi-line value). Null when unset — the proxy then sends no
 * identity, and says so once in the log, rather than refusing to serve pages that never
 * asked for one.
 */
async function load(): Promise<Loaded | null> {
  const raw = process.env.PORTAL_IDENTITY_KEY;
  if (!raw) return null;
  if (cache?.source === raw) return cache;

  const pem = raw.includes('-----BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`PORTAL_IDENTITY_KEY must be an Ed25519 key, got ${privateKey.asymmetricKeyType}`);
  }
  const jwk = await exportJWK(createPublicKey(privateKey));
  jwk.alg = 'EdDSA';
  jwk.use = 'sig';
  // The thumbprint as `kid`: derived from the key, so rotating the key rotates the id and
  // nobody has to remember to.
  jwk.kid = await calculateJwkThumbprint(jwk);
  cache = { source: raw, privateKey, jwk };
  return cache;
}

/** Whether identities can be signed at all — asked once, to log it once. */
export async function identityAvailable(): Promise<boolean> {
  try {
    return (await load()) !== null;
  } catch {
    return false;
  }
}

/** The public half, for `/api/portal-identity/jwks.json`. Null when no key is configured. */
export async function identityJwks(): Promise<{ keys: JWK[] } | null> {
  const loaded = await load();
  return loaded ? { keys: [loaded.jwk] } : null;
}

/** A signed identity, or null when no key is configured. Throws on a key that is wrong. */
export async function signIdentity(claims: IdentityClaims): Promise<string | null> {
  const loaded = await load();
  if (!loaded) return null;
  return new SignJWT({
    ...(claims.email ? { email: claims.email } : {}),
    name: claims.name ?? claims.email ?? '',
    kind: claims.kind,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: loaded.jwk.kid })
    .setIssuer(identityIssuer())
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${IDENTITY_TTL_SECONDS}s`)
    .sign(loaded.privateKey);
}
