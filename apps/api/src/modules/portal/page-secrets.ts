import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * A page's protection-bypass secret, encrypted at rest.
 *
 * It is a credential to somebody else's system (Vercel's), and without this it would sit
 * in readable form in every nightly dump and every off-site copy of the database. AES-256-GCM
 * rather than plain AES: the tag means a row that was tampered with fails to decrypt instead
 * of yielding a different secret.
 *
 * The key is `PORTAL_PAGE_KEY`, 32 bytes base64. There is deliberately no fallback and no
 * "store it plain for now" path — that path is the one nobody comes back to, and the
 * failure it prevents (a working feature quietly writing a credential in the clear) is
 * exactly the kind that is discovered years later.
 */
const FORMAT = 'v1';

export class PageSecretKeyMissing extends Error {
  constructor() {
    super(
      'PORTAL_PAGE_KEY is not set, so a bypass secret cannot be stored. Generate one with ' +
        '`openssl rand -base64 32`.',
    );
  }
}

function key(): Buffer {
  const raw = process.env.PORTAL_PAGE_KEY;
  if (!raw) throw new PageSecretKeyMissing();
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`PORTAL_PAGE_KEY must decode to 32 bytes, got ${buf.length}`);
  }
  return buf;
}

/** Whether a secret could be stored at all — asked before a form promises it can. */
export function pageSecretsAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptPageSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [FORMAT, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(
    '.',
  );
}

/**
 * Null rather than a throw when it cannot be read.
 *
 * A rotated or missing key must not take the portal down: the page still exists, and
 * serving it without the bypass header fails visibly at Vercel with a message somebody can
 * act on. Throwing here would turn one bad row into a 500 on a client's report.
 */
export function decryptPageSecret(stored: string | null): string | null {
  if (!stored) return null;
  const [format, iv, tag, data] = stored.split('.');
  if (format !== FORMAT || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}
