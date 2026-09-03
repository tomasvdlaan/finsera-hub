import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../../core/db/db.module.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';

/**
 * A signed-in client, resolved from an invitation.
 *
 * Deliberately not an `Actor`. An Actor is an internal identity with capabilities, and
 * accepting one on the client path would make it possible to serve internal data through
 * a portal endpoint by passing the wrong object. A different type makes that a compile
 * error.
 */
export interface PortalVisitor extends PortalAudience {
  portalUserId: string;
  email: string;
  /** What to call them on their own front page. Null until they have a name on file. */
  displayName?: string | null;
  /** When they were last here, *before* this visit. Null on a first sign-in. */
  previousSeenAt?: Date | null;
}

/**
 * One of us, looking at a client's portal (Phase 8, P5).
 *
 * Deliberately not a `PortalVisitor`, for the same reason a visitor is not an `Actor`: the
 * two are allowed different things, and a different type makes passing the wrong one a
 * compile error rather than a policy someone has to remember. A staff viewer may read
 * everything the client can read — that is what "see what they see" means — and may not
 * *act* as them, because accepting a quote is a statement by the client. The routes that
 * write ask for a `PortalVisitor`, so they refuse staff by construction.
 *
 * It carries a `core.users` id, so a staff read is audited under a real internal identity
 * and "who looked at Duce's portal" has an answer.
 */
export interface PortalStaff extends PortalAudience {
  staffUserId: string;
  email: string;
}

/** Anyone with a portal session. Enough to read; not necessarily enough to write. */
export type PortalViewer = PortalVisitor | PortalStaff;

/** Narrow a viewer. `'staffUserId' in v` rather than a flag, so the union stays honest. */
export function isStaff(viewer: PortalViewer): viewer is PortalStaff {
  return 'staffUserId' in viewer;
}

/**
 * Whose data a projection query is about.
 *
 * Narrower than `PortalVisitor` because there are two legitimate callers and only one of
 * them is a visitor: a signed-in client, and an internal preview of what that client sees.
 * The projection's job is "show exactly this client's data"; deciding *which* client is
 * allowed is the caller's, and there are exactly two places that decide —
 * `PortalAuthGuard` (from an invitation) and `PortalPreviewController` (from an internal
 * capability, audited). Anything else passing a clientId here is a bug.
 */
export interface PortalAudience {
  clientId: string;
}

/** Enough to serve bytes, resolved only for files this client is entitled to. */
export interface FileRef {
  filename: string;
  mime_type: string;
  storage_key: string;
}

/**
 * Everything a client can see, and nothing else.
 *
 * This is the security boundary of Phase 7, and it is built as a PROJECTION rather than a
 * filter. The distinction is the whole design:
 *
 *   A filter starts from every row and removes what should not be shown. One forgotten
 *   WHERE clause, one new column, one join added later by someone who did not know, and
 *   a client sees another client's data.
 *
 *   A projection starts from nothing and adds what should be. The queries below name
 *   every column they return and every one takes the client id as a bound parameter.
 *   There is no query here that could return another client's row, because there is no
 *   query here without that predicate.
 *
 * The manifests decide WHAT may be exposed (`portalExposure`, empty by default). This
 * decides HOW, and refuses to serve an entity type no module has declared — so adding a
 * module cannot accidentally expose anything, and removing a declaration takes it away.
 */
/**
 * Ids arrive from the client, and Postgres raises on a malformed uuid rather than
 * returning nothing. Both controllers use `ParseUUIDPipe`, so this should be unreachable —
 * but "unreachable" is a property of today's callers, and the failure it prevents is a
 * 500 with a database error in it on a client-facing surface. Nothing, quietly, is the
 * right answer to a question about a thing that cannot exist.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PortalProjection {
  private readonly logger = new Logger(PortalProjection.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly manifests: ManifestRegistry,
  ) {}

  /** Quiet to the caller, loud in the log: a malformed id is a bug somewhere upstream. */
  private plausibleId(id: string, what: string): boolean {
    if (UUID.test(id)) return true;
    this.logger.warn(`Portal read for a malformed ${what} id — refused without querying`);
    return false;
  }

  /** Fields a module has declared portal-visible for an entity type, or nothing. */
  exposedFields(entityType: string): string[] {
    const declared = this.manifests
      .all()
      .flatMap((m) => m.portalExposure)
      .filter((e) => e.entityType === entityType);
    return declared.flatMap((e) => e.fields);
  }

  /**
   * Refuse anything no module has declared.
   *
   * Called at the top of every read. Without it, adding a projection query would be
   * enough to expose an entity type — the manifest declaration would become decorative.
   */
  private assertExposed(entityType: string): void {
    if (this.exposedFields(entityType).length === 0) {
      this.logger.error(`Portal read refused: '${entityType}' is not declared portal-visible`);
      throw new BadRequestException('Not available');
    }
  }

  /**
   * And refuse any *column* no module declared.
   *
   * `assertExposed` checks that the entity type may be shown at all; this checks that what
   * is about to be returned is what was declared. Without it, the field lists in the
   * manifests describe an intention rather than a rule — narrowing one would silently
   * change nothing, and a column added to a query would reach a client's browser with
   * nobody having decided that it should.
   *
   * `derived` is for the columns a query composes rather than exposes — a project's name
   * joined onto a task, say. Naming them at the call site keeps them a short, visible list
   * instead of a hole this check quietly permits.
   */
  private assertFields(
    entityType: string,
    rows: Array<Record<string, unknown>>,
    derived: string[] = [],
  ): void {
    const row = rows[0];
    if (!row) return;
    const allowed = new Set([...this.exposedFields(entityType), ...derived]);
    const extra = Object.keys(row).filter((key) => !allowed.has(key));
    if (extra.length > 0) {
      // Loud and fatal rather than filtered: a query returning something undeclared is a
      // mistake in the query, and silently trimming it would leave the mistake in place.
      this.logger.error(
        `Portal read refused: '${entityType}' query returned undeclared fields — ${extra.join(', ')}`,
      );
      throw new BadRequestException('Not available');
    }
  }

  async projects(audience: PortalAudience) {
    this.assertExposed('project');
    const result = await this.db.execute(sql`
      SELECT p.id, p.name, p.status, p.starts_on, p.ends_on
        FROM crm.v_projects p
       WHERE p.client_id = ${audience.clientId}
       ORDER BY p.created_at DESC
    `);
    // No rates, no budget, no margin: those columns are not selected, so no future
    // change to this query can leak them by accident.
    return result.rows;
  }

  /**
   * The work, as far as a client is entitled to see it.
   *
   * Two conditions, and both are necessary: the task is marked visible, and its project
   * belongs to this client. The first is a decision somebody made per task; the second is
   * the bound parameter every query here has. Neither alone would do — a visible task on
   * somebody else's project is still somebody else's.
   *
   * Archived tasks are gone from this view. A client should not watch us delete things.
   */
  async tasks(audience: PortalAudience) {
    this.assertExposed('task');
    const result = await this.db.execute(sql`
      SELECT t.id, t.project_id, t.title, t.status, t.type, t.due_on, t.completed_at,
             p.name AS project_name
        FROM scrum.tasks t
        JOIN crm.v_projects p ON p.id = t.project_id
       WHERE p.client_id = ${audience.clientId}
         AND t.client_visible = true
         AND t.archived_at IS NULL
       ORDER BY p.name, t.completed_at NULLS FIRST, t.rank
    `);
    // No description, no assignee, no estimate, no labels, no blocked reason — and that is
    // checked rather than left to the SELECT list staying as written.
    this.assertFields('task', result.rows, ['project_name']);
    return result.rows;
  }

  /**
   * Which tabs a client should be offered at all.
   *
   * A client with no quotes seeing an empty Offertes tab reads as neglect, and a per-client
   * list of switches to keep in step with reality reads as a settings screen nobody updates.
   * So it is derived: a tab exists when there is something behind it.
   *
   * Built from the same queries the tabs themselves run, rather than from counts written
   * separately — a tab that disagrees with the page behind it is worse than either answer.
   * Cheap enough at this size, and it runs once per page load.
   *
   * Vragen is always offered, whatever it returns. Hiding it when a client has asked
   * nothing would take away the one thing they came to do.
   */
  async availability(audience: PortalAudience) {
    const [projects, tasks, quotes, invoices, documents] = await Promise.all([
      this.ifExposed('project', () => this.projects(audience)),
      this.ifExposed('task', () => this.tasks(audience)),
      this.ifExposed('quote', () => this.quotes(audience)),
      this.ifExposed('invoice', () => this.invoices(audience)),
      this.ifExposed('document', () => this.documents(audience)),
    ]);
    return {
      projects: projects.length > 0,
      tasks: tasks.length > 0,
      quotes: quotes.length > 0,
      invoices: invoices.length > 0,
      documents: documents.length > 0,
    };
  }

  /**
   * A query, or nothing at all if the owning module does not expose that type.
   *
   * Everywhere else an undeclared type is a refusal, because somewhere else somebody asked
   * for it directly. Here the question is "is there anything behind this tab", and a type
   * no module publishes has nothing behind it by definition — so the honest answer is an
   * empty list rather than an error that takes the whole front page down with it.
   */
  private async ifExposed(
    entityType: string,
    run: () => Promise<Array<Record<string, unknown>>>,
  ): Promise<Array<Record<string, unknown>>> {
    return this.exposedFields(entityType).length === 0 ? [] : run();
  }

  /**
   * The front page: what is waiting on the client, and what has changed since they were here.
   *
   * Deliberately not a dashboard. This platform shows a client nothing about the business,
   * and a page of totals would be the first place that stopped being true — so the
   * organising question is "what needs you", not "how much of everything is there".
   *
   * Everything is filtered in memory from the same projection queries the pages use. That
   * is a few more rows than a purpose-built query would move and one fewer place for the
   * rule about what a client may see to be written down differently.
   */
  async overview(audience: PortalAudience, since: Date | null) {
    const [projects, quotes, invoices] = await Promise.all([
      this.ifExposed('project', () => this.projects(audience)),
      this.ifExposed('quote', () => this.quotes(audience)),
      this.ifExposed('invoice', () => this.invoices(audience)),
    ]);

    const newer = (value: unknown) => {
      if (!since || typeof value !== 'string') return false;
      const at = new Date(value);
      return !Number.isNaN(at.getTime()) && at > since;
    };

    return {
      since: since?.toISOString() ?? null,
      // The three things a client can actually act on, and nothing else can appear here
      // because nothing else in this portal is an action they can take.
      awaiting: {
        quotes: quotes.filter((q) => q.status === 'sent' && q.expired !== true),
        invoices: invoices.filter((i) => i.overdue === true),
      },
      // What changed while they were away. Nothing is "new" on a first visit, which is
      // right: everything is, and saying so would be noise on the one screen that should
      // read as a welcome.
      recent: {
        invoices: invoices.filter((i) => newer(i.issue_date)),
      },
      // What is under way, which is not the same as everything on file: a prospective or
      // cancelled project under a heading that says "loopt nu" would be a small lie, and a
      // completed one belongs in the list rather than on the front page.
      projects: projects.filter((p) => p.status === 'active' || p.status === 'on_hold'),
    };
  }

  async invoices(audience: PortalAudience) {
    this.assertExposed('invoice');
    const result = await this.db.execute(sql`
      SELECT i.id, i.number, i.status, i.issue_date, i.due_on,
             i.subtotal_cents, i.vat_cents, i.total_cents, i.overdue, i.currency
        FROM billing.v_invoices i
       WHERE i.client_id = ${audience.clientId}
         AND i.status IN ('issued', 'paid')
       ORDER BY i.issue_date DESC
    `);
    // Drafts are excluded on purpose: an invoice that has not been sent is not something
    // the client is owed sight of, and seeing one change would be worse than not seeing it.
    return result.rows;
  }

  async quotes(audience: PortalAudience) {
    this.assertExposed('quote');
    const result = await this.db.execute(sql`
      SELECT q.id, q.number, q.title, q.status, q.issue_date, q.valid_until,
             q.subtotal_cents, q.vat_cents, q.total_cents, q.expired
        FROM sales.v_quotes q
       WHERE q.client_id = ${audience.clientId}
         AND q.status IN ('sent', 'accepted', 'rejected')
       ORDER BY q.issue_date DESC
    `);
    return result.rows;
  }

  async quoteLines(audience: PortalAudience, quoteId: string) {
    this.assertExposed('quote');
    if (!this.plausibleId(quoteId, 'quote')) return [];
    // The quote id comes from the client, so ownership is re-checked here rather than
    // assumed from the list they were shown.
    const result = await this.db.execute(sql`
      SELECT l.description, l.quantity, l.unit_price_cents, l.amount_cents, l.unit
        FROM sales.quote_lines l
        JOIN sales.v_quotes q ON q.id = l.quote_id
       WHERE l.quote_id = ${quoteId}
         AND q.client_id = ${audience.clientId}
         AND q.status IN ('sent', 'accepted', 'rejected')
       ORDER BY l.position
    `);
    return result.rows;
  }

  /**
   * Documents explicitly shared with this client.
   *
   * Note what this is NOT: every document whose `client_id` matches. A document filed
   * against a client is filed for our benefit — an internal analysis, a draft, notes on
   * a negotiation — and "belongs to this client" is not the same as "may be shown to
   * them". Sharing is a deliberate act, recorded as a link.
   */
  async documents(audience: PortalAudience) {
    this.assertExposed('document');
    const result = await this.db.execute(sql`
      SELECT d.id, d.title, d.category, d.created_at
        FROM docs.v_documents d
        JOIN core.links l ON l.from_id = d.id
       WHERE l.to_id = ${audience.clientId}
         AND l.link_kind = 'shared_with_client'
       ORDER BY d.created_at DESC
    `);
    return result.rows;
  }

  /**
   * Where an invoice's archived PDF lives, if this client owns that invoice.
   *
   * Note what this does not do: render one. `BillingService.getPdf` falls back to a live
   * render when the archive is missing, and the portal deliberately cannot — rendering
   * would mean importing Billing, and the whole module is built on not doing that. A
   * missing archive is therefore a 404 here, and an operational problem worth knowing
   * about rather than papering over.
   */
  async invoiceFile(audience: PortalAudience, invoiceId: string) {
    this.assertExposed('invoice');
    if (!this.plausibleId(invoiceId, 'invoice')) return null;
    const result = await this.db.execute(sql`
      SELECT d.filename, d.mime_type, d.storage_key
        FROM billing.v_invoices i
        JOIN docs.v_documents d ON d.id = i.pdf_document_id
       WHERE i.id = ${invoiceId}
         AND i.client_id = ${audience.clientId}
         AND i.status IN ('issued', 'paid')
       LIMIT 1
    `);
    return (result.rows[0] as FileRef | undefined) ?? null;
  }

  /** Where a shared document's bytes live, if it is in fact shared with this client. */
  async documentFile(audience: PortalAudience, documentId: string) {
    this.assertExposed('document');
    if (!this.plausibleId(documentId, 'document')) return null;
    const result = await this.db.execute(sql`
      SELECT d.filename, d.mime_type, d.storage_key
        FROM docs.v_documents d
        JOIN core.links l ON l.from_id = d.id
       WHERE d.id = ${documentId}
         AND l.to_id = ${audience.clientId}
         AND l.link_kind = 'shared_with_client'
       LIMIT 1
    `);
    return (result.rows[0] as FileRef | undefined) ?? null;
  }

  /** Whether one document is shared with this client — checked before serving bytes. */
  async mayReadDocument(audience: PortalAudience, documentId: string): Promise<boolean> {
    if (!this.plausibleId(documentId, 'document')) return false;
    const result = await this.db.execute(sql`
      SELECT 1
        FROM core.links l
       WHERE l.from_id = ${documentId}
         AND l.to_id = ${audience.clientId}
         AND l.link_kind = 'shared_with_client'
       LIMIT 1
    `);
    return result.rows.length > 0;
  }
}
