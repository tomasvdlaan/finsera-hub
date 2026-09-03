import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import {
  PageSecretKeyMissing,
  decryptPageSecret,
  encryptPageSecret,
  pageSecretsAvailable,
} from './page-secrets.js';
import { portalPages } from './portal.schema.js';

/** A page slug is one path segment on a host the SPA also routes. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

/**
 * Names the portal itself answers to.
 *
 * A page called `facturen` would shadow the invoices page — the proxy runs first, so the
 * client would lose a tab and nobody would know why. `api` and `assets` are the API prefix
 * and the bundle's own files. Kept as a list because the SPA's routes are a list.
 */
const RESERVED = [
  'api',
  'assets',
  'auth',
  'projecten',
  'taken',
  'offertes',
  'facturen',
  'documenten',
  'vragen',
  'tickets',
  'rapporten',
];

export interface PageInput {
  slug: string;
  title: string;
  kind?: 'proxy' | 'redirect';
  sourceUrl: string;
  /** Write-only. Undefined leaves it alone; null clears it; a string replaces it. */
  bypassSecret?: string | null;
  enabled?: boolean;
}

/** What a page looks like to whoever may administer one. Never the secret itself. */
export interface PageRow {
  id: string;
  slug: string;
  title: string;
  kind: string;
  sourceUrl: string;
  enabled: boolean;
  hasSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The custom content a client can be given, and the rules about where it may come from.
 *
 * The fetching itself lives in `portal-proxy.ts`, because that is a request pipeline and
 * this is a table. What is here is everything that decides *whether* a URL may be stored:
 * https only, no address inside our own network, no name the portal already answers to.
 *
 * The SSRF check matters more than it looks. This is the one place in the platform where
 * an internal user's input becomes a server-side request, so an unchecked URL would let
 * somebody with `portal.admin` read the metadata service, the database port, or anything
 * else the container can reach — and get the answer rendered into a client's browser.
 */
@Injectable()
export class PortalPagesService {
  private readonly logger = new Logger(PortalPagesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  /** The page a path's first segment names, if this client has one and it is on. */
  async find(clientId: string, slug: string) {
    if (!SLUG.test(slug)) return null;
    const [row] = await this.db
      .select()
      .from(portalPages)
      .where(and(eq(portalPages.clientId, clientId), eq(portalPages.slug, slug)))
      .limit(1);
    if (!row || !row.enabled) return null;
    return row;
  }

  /** What the client sees in their Rapporten tab: a title and a link, nothing about where. */
  async forClient(clientId: string): Promise<Array<{ slug: string; title: string; kind: string }>> {
    return this.db
      .select({ slug: portalPages.slug, title: portalPages.title, kind: portalPages.kind })
      .from(portalPages)
      .where(and(eq(portalPages.clientId, clientId), eq(portalPages.enabled, true)))
      .orderBy(asc(portalPages.title));
  }

  async list(actor: Actor, clientId: string): Promise<PageRow[]> {
    await this.require(actor, 'portal.admin');
    const rows = await this.db
      .select()
      .from(portalPages)
      .where(eq(portalPages.clientId, clientId))
      .orderBy(asc(portalPages.title));
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      kind: r.kind,
      sourceUrl: r.sourceUrl,
      enabled: r.enabled,
      // Whether one is set, never what it is. A write-only field that reads back as "set"
      // is the only shape that lets somebody see the state without seeing the credential.
      hasSecret: r.bypassSecretEnc !== null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async create(actor: Actor, clientId: string, input: PageInput): Promise<{ id: string }> {
    await this.require(actor, 'portal.admin');
    const slug = this.validSlug(input.slug);
    const sourceUrl = await this.validSource(input.sourceUrl);
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('A page needs a title');

    const [existing] = await this.db
      .select({ id: portalPages.id })
      .from(portalPages)
      .where(and(eq(portalPages.clientId, clientId), eq(portalPages.slug, slug)))
      .limit(1);
    if (existing) throw new BadRequestException(`This client already has a page at '${slug}'`);

    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(portalPages).values({
        id,
        clientId,
        slug,
        title,
        kind: input.kind ?? 'proxy',
        sourceUrl,
        bypassSecretEnc: this.encrypt(input.bypassSecret ?? null),
        enabled: input.enabled ?? true,
        createdBy: actor.userId,
      });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.page.create',
        entityType: 'client',
        entityId: clientId,
        // The source URL is in the audit deliberately: "where did that report actually come
        // from" is the question asked months later, and the row may have changed by then.
        detail: { slug, title, sourceUrl, kind: input.kind ?? 'proxy' },
      });
    });
    return { id };
  }

  async update(actor: Actor, id: string, input: Partial<PageInput>): Promise<PageRow> {
    await this.require(actor, 'portal.admin');
    const [before] = await this.db.select().from(portalPages).where(eq(portalPages.id, id)).limit(1);
    if (!before) throw new NotFoundException('No such page');

    const slug = input.slug === undefined ? before.slug : this.validSlug(input.slug);
    const sourceUrl =
      input.sourceUrl === undefined ? before.sourceUrl : await this.validSource(input.sourceUrl);
    if (slug !== before.slug) {
      const [clash] = await this.db
        .select({ id: portalPages.id })
        .from(portalPages)
        .where(and(eq(portalPages.clientId, before.clientId), eq(portalPages.slug, slug)))
        .limit(1);
      if (clash) throw new BadRequestException(`This client already has a page at '${slug}'`);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(portalPages)
        .set({
          slug,
          title: input.title?.trim() || before.title,
          kind: input.kind ?? (before.kind as 'proxy' | 'redirect'),
          sourceUrl,
          // Undefined leaves the stored secret alone — a form that posts every field must
          // not erase a credential it never showed the person editing.
          bypassSecretEnc:
            input.bypassSecret === undefined
              ? before.bypassSecretEnc
              : this.encrypt(input.bypassSecret),
          enabled: input.enabled ?? before.enabled,
          updatedAt: new Date(),
        })
        .where(eq(portalPages.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.page.update',
        entityType: 'client',
        entityId: before.clientId,
        detail: {
          before: { slug: before.slug, sourceUrl: before.sourceUrl, enabled: before.enabled },
          after: { slug, sourceUrl, enabled: input.enabled ?? before.enabled },
          secretChanged: input.bypassSecret !== undefined,
        },
      });
    });
    const row = (await this.list(actor, before.clientId)).find((r) => r.id === id);
    // The row was updated a line ago inside a committed transaction, so its absence would
    // mean something deleted it in between — worth an error rather than an empty object.
    if (!row) throw new NotFoundException('No such page');
    return row;
  }

  async remove(actor: Actor, id: string): Promise<{ id: string }> {
    await this.require(actor, 'portal.admin');
    const [before] = await this.db.select().from(portalPages).where(eq(portalPages.id, id)).limit(1);
    if (!before) throw new NotFoundException('No such page');

    await this.db.transaction(async (tx) => {
      await tx.delete(portalPages).where(eq(portalPages.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.page.delete',
        entityType: 'client',
        entityId: before.clientId,
        detail: { slug: before.slug, title: before.title, sourceUrl: before.sourceUrl },
      });
    });
    return { id };
  }

  /** The decrypted bypass secret for a page, for the proxy alone. */
  secretFor(row: { bypassSecretEnc: string | null }): string | null {
    return decryptPageSecret(row.bypassSecretEnc);
  }

  /** Whether the deployment answers, without making anybody open the client's portal. */
  async probe(actor: Actor, id: string): Promise<{ status: number; ok: boolean; note?: string }> {
    await this.require(actor, 'portal.admin');
    const [row] = await this.db.select().from(portalPages).where(eq(portalPages.id, id)).limit(1);
    if (!row) throw new NotFoundException('No such page');

    const secret = this.secretFor(row);
    try {
      const res = await fetch(row.sourceUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          ...(secret ? { 'x-vercel-protection-bypass': secret } : {}),
          'user-agent': 'Finsera-Portal/1.0',
        },
        signal: AbortSignal.timeout(10_000),
      });
      // Named, because the three interesting failures look alike from a status code alone.
      const note =
        res.status === 401 || res.status === 403
          ? row.bypassSecretEnc
            ? 'Refused — the bypass secret may be wrong or from another Vercel project.'
            : 'Refused — this deployment is protected and no bypass secret is set.'
          : res.status >= 300 && res.status < 400
            ? 'Redirects. The proxy follows one only if it stays on the same origin.'
            : undefined;
      return { status: res.status, ok: res.ok, note };
    } catch (err) {
      return { status: 0, ok: false, note: `Could not be reached: ${(err as Error).message}` };
    }
  }

  // ── the rules ──

  private validSlug(raw: string): string {
    const slug = raw.trim().toLowerCase();
    if (!SLUG.test(slug)) {
      throw new BadRequestException(
        'A page address is 2–60 lowercase letters, digits or hyphens, starting and ending ' +
          'with a letter or digit',
      );
    }
    if (RESERVED.includes(slug)) {
      throw new BadRequestException(`'${slug}' is a page the portal already has`);
    }
    return slug;
  }

  /**
   * Where content may be fetched from.
   *
   * https only — an http source would be a downgrade this platform caused, on a page a
   * client reaches over TLS. And the address must be outside our own network and outside
   * our own domains: this is the only place where an internal user's text becomes a
   * server-side request, so without those checks somebody holding `portal.admin` could
   * point a page at the container network, a cloud metadata endpoint, or the platform's own
   * API, and read the answer in a client's browser.
   *
   * The DNS lookup is checked at save time, not at fetch time, so a name that changes where
   * it points afterwards would slip past — and `probe()` runs against the stored URL, so it
   * has the same exposure. That is a real gap and a documented one: closing it needs a
   * pinned-address fetch, which Node's fetch does not offer. What this stops is every
   * version somebody would actually type, from a caller who already holds `portal.admin`.
   */
  private async validSource(raw: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new BadRequestException('That is not a URL');
    }
    if (url.protocol !== 'https:') {
      throw new BadRequestException('A source must be https — the client reads it over TLS');
    }
    if (url.username || url.password) {
      throw new BadRequestException('Credentials do not belong in a source URL');
    }

    const host = url.hostname.replace(/^\[|\]$/g, '');
    // Our own names, which resolve to public addresses and so would pass the check below.
    // A page pointed at the platform would be the proxy fetching the platform with the
    // platform's own credentials attached to nothing — confusing at best, a loop at worst.
    for (const ours of [process.env.PORTAL_BASE_DOMAIN, process.env.SITE_ADDRESS, process.env.PORTAL_AUTH_HOST]) {
      const own = (ours ?? '').trim().toLowerCase().replace(/:\d+$/, '');
      if (own && (host === own || host.endsWith(`.${own}`))) {
        throw new BadRequestException(`'${url.hostname}' is one of ours — content lives elsewhere`);
      }
    }
    const addresses = isIP(host)
      ? [host]
      : await lookup(host, { all: true })
          .then((r) => r.map((a) => a.address))
          .catch(() => {
            throw new BadRequestException(`'${url.hostname}' does not resolve`);
          });
    for (const address of addresses) {
      if (isPrivate(address)) {
        throw new BadRequestException(
          `'${url.hostname}' resolves to ${address}, which is inside our own network`,
        );
      }
    }

    // Trailing slash removed once, here, so the proxy can join paths without guessing.
    return url.toString().replace(/\/$/, '');
  }

  private encrypt(secret: string | null): string | null {
    if (secret === null || secret.trim() === '') return null;
    if (!pageSecretsAvailable()) throw new BadRequestException(new PageSecretKeyMissing().message);
    return encryptPageSecret(secret.trim());
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }
}

/**
 * Addresses a page may not be fetched from: loopback, link-local, and the private ranges,
 * v4 and v6 alike — including the v4-mapped v6 forms, which are the ones a check written
 * against dotted quads alone quietly misses.
 */
export function isPrivate(address: string): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a = -1, b = -1] = v4.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  const v6 = address.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique-local
  if (v6.startsWith('fe80')) return true; // link-local
  return false;
}
