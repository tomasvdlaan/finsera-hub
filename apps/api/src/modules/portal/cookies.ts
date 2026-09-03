import type { Request, Response } from 'express';

/** The session cookie. Short, and unrelated to anything the internal app sets. */
export const SESSION_COOKIE = 'psid';
/** The in-flight login state, on the auth host only. */
export const LOGIN_COOKIE = 'psa';
/** The nonce tying a handoff ticket to the browser that started the login, on its own host. */
export const BINDING_COOKIE = 'psb';
/** The path the login cookie is scoped to; nothing outside the auth flow can read it. */
export const LOGIN_COOKIE_PATH = '/api/portal-auth';

/**
 * One cookie by name, from the raw header.
 *
 * No `cookie-parser`: it would parse every cookie on every request across the whole API for
 * the sake of one name on one module's routes, and a dependency whose job is "read a header"
 * is one more thing to keep current.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Whether cookies set on this request may carry `Secure`.
 *
 * `req.secure` reflects `X-Forwarded-Proto` because `trust proxy` is on, so behind Caddy it
 * is true and locally, over plain HTTP from Vite, it is false — and a `Secure` cookie set over
 * HTTP is silently dropped by the browser, which is the worst kind of failure to debug.
 */
export function secureCookies(req: Request): boolean {
  return req.secure;
}

export function setSessionCookie(req: Request, res: Response, value: string, maxAgeMs: number) {
  res.cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: secureCookies(req),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: secureCookies(req),
    sameSite: 'lax',
    path: '/',
  });
}

export function setLoginCookie(req: Request, res: Response, value: string, maxAgeMs: number) {
  res.cookie(LOGIN_COOKIE, value, {
    httpOnly: true,
    secure: secureCookies(req),
    sameSite: 'lax',
    path: LOGIN_COOKIE_PATH,
    maxAge: maxAgeMs,
  });
}

export function setBindingCookie(req: Request, res: Response, value: string, maxAgeMs: number) {
  res.cookie(BINDING_COOKIE, value, {
    httpOnly: true,
    secure: secureCookies(req),
    sameSite: 'lax',
    path: LOGIN_COOKIE_PATH,
    maxAge: maxAgeMs,
  });
}

export function clearBindingCookie(req: Request, res: Response) {
  res.clearCookie(BINDING_COOKIE, {
    httpOnly: true,
    secure: secureCookies(req),
    sameSite: 'lax',
    path: LOGIN_COOKIE_PATH,
  });
}

export function clearLoginCookie(req: Request, res: Response) {
  res.clearCookie(LOGIN_COOKIE, {
    httpOnly: true,
    secure: secureCookies(req),
    sameSite: 'lax',
    path: LOGIN_COOKIE_PATH,
  });
}
