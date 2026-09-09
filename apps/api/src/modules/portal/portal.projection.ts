import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../../core/db/db.module.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PortalAccessService } from './portal-access.service.js';
import type {
  PortalAudience,
  PortalStaff,
  PortalViewer,
  PortalVisitor,
} from './portal-viewer.js';

/**
 * Viewer types live in `portal-viewer.ts` so that `PortalAccessService` can name them
 * without importing this file back. Re-exported here because this is where callers have
 * always found them.
 */
export type { PortalAudience, PortalStaff, PortalViewer, PortalVisitor };

/** Narrow a viewer. `'staffUserId' in v` rather than a flag, so the union stays honest. */
export function isStaff(viewer: PortalViewer): viewer is PortalStaff {
  return 'staffUserId' in viewer;
}

/**
 * May this viewer see a whole section — the invoices, the quotes?
 *
 * Staff always may: one of us looking at a client's portal is checking what the client has,
 * and a preview that hid half of it would be answering a different question. Which of *their*
 * people can see it is set per person and shown on the internal side.
 */
export function maySeeSection(viewer: PortalViewer, section: 'invoices' | 'quotes'): boolean {
  if (isStaff(viewer)) return true;
  return section === 'invoices' ? viewer.seesInvoices : viewer.seesQuotes;
}

/**
 * Enough to serve bytes, resolved only for files this client is entitled to.
 *
 * Since D8 a document's bytes may be in SharePoint, so this carries a pointer rather than a
 * key. What it must NEVER carry is web_url: that is a link into a library holding every
 * other client's documents, and a client who received one would hold a door the portal's
 * whole visibility model exists to keep shut. The view it is selected from does not publish
 * that column, and a spec asserts no portal response body ever contains one.
 */
export interface FileRef {
  filename: string;
  mime_type: string;
  storage_backend: string;
  storage_key: string | null;
  drive_id: string | null;
  drive_item_id: string | null;
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
    private readonly access: PortalAccessService,
  ) {}

  /**
   * Whether this audience may see a whole section.
   *
   * The per-person rules live here rather than in the controller, and that is the same
   * argument the projection is built on: one place that decides what is shown beats six
   * routes that each remember to ask. Every path into the money — the tabs, the front page,
   * the list, the PDF — goes through `invoices()` or `quotes()`, so gating those two gates
   * all of it.
   *
   * An audience with no flags at all is the internal preview, which asks a different
   * question: what does *this client* see, not what does one person at it see. It sees the
   * section.
   */
  private sees(audience: PortalAudience, section: 'invoices' | 'quotes'): boolean {
    if (!('seesInvoices' in audience)) return true;
    const viewer = audience as PortalVisitor;
    return section === 'invoices' ? viewer.seesInvoices : viewer.seesQuotes;
  }

  /**
   * The artefacts of this kind this audience must not be shown, as a SQL fragment.
   *
   * An empty list becomes `TRUE` rather than `id NOT IN ()`, which is a syntax error in
   * Postgres and would take the ordinary case — nothing restricted anywhere — down with it.
   */
  private async hidden(
    audience: PortalAudience,
    kind: 'page' | 'document',
    column = sql`d.id`,
  ) {
    if (!('portalUserId' in audience)) return sql`TRUE`;
    const ids = await this.access.hiddenIds(kind, audience as PortalVisitor);
    if (ids.length === 0) return sql`TRUE`;
    return sql`${column} NOT IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;
  }

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
    // Not their section: an empty list, not an error. Everything that composes invoices —
    // the tab, the front page's "overdue", the list — reads this, and each of them wants
    // "there is nothing here for you" rather than an exception to handle.
    if (!this.sees(audience, 'invoices')) return [];
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
    if (!this.sees(audience, 'quotes')) return [];
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
    if (!this.sees(audience, 'quotes')) return [];
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
    // Two conditions, and they are not the same kind of thing. The link is what makes a
    // document the client's at all; the second clause is which of the client's people this
    // one is for. Losing the first would show another client's file, losing the second
    // shows a colleague's — so both are here, in the query, rather than filtered after.
    const mine = await this.hidden(audience, 'document');
    const result = await this.db.execute(sql`
      SELECT d.id, d.title, d.category, d.created_at
        FROM docs.v_documents d
        JOIN core.links l ON l.from_id = d.id
       WHERE l.to_id = ${audience.clientId}
         AND l.link_kind = 'shared_with_client'
         AND ${mine}
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
    // The list is not what protects a PDF: a link to one may have been mailed on months
    // before anybody's access to the section was narrowed.
    if (!this.sees(audience, 'invoices')) return null;
    if (!this.plausibleId(invoiceId, 'invoice')) return null;
    const result = await this.db.execute(sql`
      SELECT d.filename, d.mime_type,
             d.storage_backend, d.storage_key, d.drive_id, d.drive_item_id
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
    const mine = await this.hidden(audience, 'document');
    const result = await this.db.execute(sql`
      SELECT d.filename, d.mime_type,
             d.storage_backend, d.storage_key, d.drive_id, d.drive_item_id
        FROM docs.v_documents d
        JOIN core.links l ON l.from_id = d.id
       WHERE d.id = ${documentId}
         AND l.to_id = ${audience.clientId}
         AND l.link_kind = 'shared_with_client'
         AND ${mine}
       LIMIT 1
    `);
    return (result.rows[0] as FileRef | undefined) ?? null;
  }

  /** Whether one document is shared with this client — checked before serving bytes. */
  async mayReadDocument(audience: PortalAudience, documentId: string): Promise<boolean> {
    if (!this.plausibleId(documentId, 'document')) return false;
    const mine = await this.hidden(audience, 'document', sql`l.from_id`);
    const result = await this.db.execute(sql`
      SELECT 1
        FROM core.links l
       WHERE l.from_id = ${documentId}
         AND l.to_id = ${audience.clientId}
         AND l.link_kind = 'shared_with_client'
         AND ${mine}
       LIMIT 1
    `);
    return result.rows.length > 0;
  }
}
