import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PORTAL_SLUG_PATTERN } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../../core/db/db.module.js';

/** What a hostname turned out to be. */
export type PortalHost =
  /** The login callback host — `portal.finsera.nl`. Hosts the callback and, until step 2, the portal itself. */
  | { kind: 'auth'; host: string }
  /** A client's own portal — `duce.finsera.nl`. */
  | { kind: 'client'; host: string; slug: string; clientId: string; clientName: string };

/**
 * Which portal a request arrived at, from the `Host` header and nothing else.
 *
 * The header is trusted because Caddy is the only thing that reaches this process and it
 * sets `Host` to the name it accepted a certificate for. `X-Forwarded-Host` is deliberately
 * not read: it is the header a client can send, and nothing here should let a client name
 * a host.
 *
 * What comes out is used for exactly one authorisation decision: after a session has already
 * named a client, "does this host belong to that client?" The host never picks the client for
 * a client session — see `PortalAuthGuard`. Everything else it decides is routing: whether to
 * serve the portal bundle at all, and where a login should come back to.
 */
@Injectable()
export class PortalHostService implements OnModuleInit {
  private readonly logger = new Logger(PortalHostService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /** `finsera.nl` in production, `localhost:5174` in development. Slugs go in front of it. */
  get baseDomain(): string {
    return normalise(process.env.PORTAL_BASE_DOMAIN ?? 'localhost:5174');
  }

  /** Where Zitadel sends every login back to. */
  get authHost(): string {
    return normalise(process.env.PORTAL_AUTH_HOST ?? 'localhost:5174');
  }

  /**
   * A production deploy with no base domain would treat `localhost:5174` as its domain and
   * serve nothing to anybody — which is safe, and also a misconfiguration that deserves to be
   * said out loud rather than discovered from a blank page.
   */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'production' && !process.env.PORTAL_BASE_DOMAIN) {
      this.logger.warn(
        'PORTAL_BASE_DOMAIN is not set — no client portal host will resolve. Set it to ' +
          'the domain client portals hang off (e.g. finsera.nl) and PORTAL_AUTH_HOST to ' +
          'the login callback host (e.g. portal.finsera.nl).',
      );
      return;
    }
    this.logger.log(`Portal hosts: *.${this.baseDomain}, login via ${this.authHost}`);
  }

  /** The full hostname a slug lives at. */
  hostFor(slug: string): string {
    return `${slug}.${this.baseDomain}`;
  }

  /**
   * Resolve a `Host` header. Null means "not a portal host" — including a slug nobody has,
   * an archived client, and `hub` — and a caller treats null as 404, not as an error to
   * explain. The response to a guessed hostname should not confirm what the platform is.
   */
  async resolve(hostHeader: string | undefined): Promise<PortalHost | null> {
    if (!hostHeader) return null;
    const host = normalise(hostHeader);
    if (host === this.authHost) return { kind: 'auth', host };

    const suffix = `.${this.baseDomain}`;
    if (!host.endsWith(suffix)) return null;
    const slug = host.slice(0, -suffix.length);
    // One label only, and a well-formed one. `a.b.finsera.nl` is not a client, and neither is
    // anything the CHECK constraint on the column would have refused.
    if (!PORTAL_SLUG_PATTERN.test(slug)) return null;

    /*
     * Asked every time, deliberately.
     *
     * This started as a thirty-second cache, which was wrong in a way worth recording:
     * clearing a slug and archiving a client are the two ways a portal is taken away, and
     * both would have left it live for the rest of the window — while reassigning a slug
     * would have sent its new owner to a 403 at their own address. Keeping it correct meant
     * CRM reaching into this service to invalidate it, which is a module knowing about
     * another module's cache.
     *
     * One indexed lookup of one row, on a table with as many rows as there are clients,
     * costs less than that arrangement. If it ever stops being cheap, the fix is a cache
     * this service invalidates from an event, not one that expires and hopes.
     */
    return this.lookup(slug, host);
  }

  /** Whether a host is one the portal answers on at all. Used by the static server. */
  async isPortalHost(hostHeader: string | undefined): Promise<boolean> {
    return (await this.resolve(hostHeader)) !== null;
  }

  /** The slug a client has, or null. Read straight through — this is for admin screens. */
  async slugOf(clientId: string): Promise<string | null> {
    const { rows } = await this.db.execute<{ portal_slug: string | null }>(
      sql`SELECT portal_slug FROM crm.clients WHERE id = ${clientId} AND archived_at IS NULL`,
    );
    return rows[0]?.portal_slug ?? null;
  }

  private async lookup(slug: string, host: string): Promise<PortalHost | null> {
    // Raw SQL against the CRM table rather than an import of its schema: the portal reads
    // other modules through published views and bound parameters, and this is one column of
    // one row, looked up by a value the CHECK constraint already shaped.
    const { rows } = await this.db.execute<{ id: string; name: string }>(
      sql`SELECT id, name FROM crm.clients WHERE portal_slug = ${slug} AND archived_at IS NULL`,
    );
    const row = rows[0];
    if (!row) return null;
    return { kind: 'client', host, slug, clientId: row.id, clientName: row.name };
  }
}

/** Lowercase, no trailing dot, no surrounding whitespace — the forms one hostname arrives in. */
function normalise(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}
