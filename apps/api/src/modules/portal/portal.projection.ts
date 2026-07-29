import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../../core/db/db.module.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';

/**
 * Who is asking, and which client they are.
 *
 * Deliberately not an `Actor`. An Actor is an internal identity with capabilities, and
 * accepting one here would make it possible to serve internal data through a portal
 * endpoint by passing the wrong object. A different type makes that a compile error.
 */
export interface PortalVisitor {
  portalUserId: string;
  clientId: string;
  email: string;
}

/** Enough to serve bytes, resolved only for files the visitor is entitled to. */
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
@Injectable()
export class PortalProjection {
  private readonly logger = new Logger(PortalProjection.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly manifests: ManifestRegistry,
  ) {}

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

  async projects(visitor: PortalVisitor) {
    this.assertExposed('project');
    const result = await this.db.execute(sql`
      SELECT p.id, p.name, p.status, p.starts_on, p.ends_on
        FROM crm.v_projects p
       WHERE p.client_id = ${visitor.clientId}
       ORDER BY p.created_at DESC
    `);
    // No rates, no budget, no margin: those columns are not selected, so no future
    // change to this query can leak them by accident.
    return result.rows;
  }

  async invoices(visitor: PortalVisitor) {
    this.assertExposed('invoice');
    const result = await this.db.execute(sql`
      SELECT i.id, i.number, i.status, i.issue_date, i.due_on,
             i.subtotal_cents, i.vat_cents, i.total_cents, i.overdue, i.currency
        FROM billing.v_invoices i
       WHERE i.client_id = ${visitor.clientId}
         AND i.status IN ('issued', 'paid')
       ORDER BY i.issue_date DESC
    `);
    // Drafts are excluded on purpose: an invoice that has not been sent is not something
    // the client is owed sight of, and seeing one change would be worse than not seeing it.
    return result.rows;
  }

  async quotes(visitor: PortalVisitor) {
    this.assertExposed('quote');
    const result = await this.db.execute(sql`
      SELECT q.id, q.number, q.title, q.status, q.issue_date, q.valid_until,
             q.subtotal_cents, q.vat_cents, q.total_cents, q.expired
        FROM sales.v_quotes q
       WHERE q.client_id = ${visitor.clientId}
         AND q.status IN ('sent', 'accepted', 'rejected')
       ORDER BY q.issue_date DESC
    `);
    return result.rows;
  }

  async quoteLines(visitor: PortalVisitor, quoteId: string) {
    this.assertExposed('quote');
    // The quote id comes from the client, so ownership is re-checked here rather than
    // assumed from the list they were shown.
    const result = await this.db.execute(sql`
      SELECT l.description, l.quantity, l.unit_price_cents, l.amount_cents, l.unit
        FROM sales.quote_lines l
        JOIN sales.v_quotes q ON q.id = l.quote_id
       WHERE l.quote_id = ${quoteId}
         AND q.client_id = ${visitor.clientId}
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
  async documents(visitor: PortalVisitor) {
    this.assertExposed('document');
    const result = await this.db.execute(sql`
      SELECT d.id, d.title, d.category, d.created_at
        FROM docs.v_documents d
        JOIN core.links l ON l.from_id = d.id
       WHERE l.to_id = ${visitor.clientId}
         AND l.link_kind = 'shared_with_client'
       ORDER BY d.created_at DESC
    `);
    return result.rows;
  }

  /**
   * Where an invoice's archived PDF lives, if the visitor owns that invoice.
   *
   * Note what this does not do: render one. `BillingService.getPdf` falls back to a live
   * render when the archive is missing, and the portal deliberately cannot — rendering
   * would mean importing Billing, and the whole module is built on not doing that. A
   * missing archive is therefore a 404 here, and an operational problem worth knowing
   * about rather than papering over.
   */
  async invoiceFile(visitor: PortalVisitor, invoiceId: string) {
    this.assertExposed('invoice');
    const result = await this.db.execute(sql`
      SELECT d.filename, d.mime_type, d.storage_key
        FROM billing.v_invoices i
        JOIN docs.v_documents d ON d.id = i.pdf_document_id
       WHERE i.id = ${invoiceId}
         AND i.client_id = ${visitor.clientId}
         AND i.status IN ('issued', 'paid')
       LIMIT 1
    `);
    return (result.rows[0] as FileRef | undefined) ?? null;
  }

  /** Where a shared document's bytes live, if it is in fact shared with this visitor. */
  async documentFile(visitor: PortalVisitor, documentId: string) {
    this.assertExposed('document');
    const result = await this.db.execute(sql`
      SELECT d.filename, d.mime_type, d.storage_key
        FROM docs.v_documents d
        JOIN core.links l ON l.from_id = d.id
       WHERE d.id = ${documentId}
         AND l.to_id = ${visitor.clientId}
         AND l.link_kind = 'shared_with_client'
       LIMIT 1
    `);
    return (result.rows[0] as FileRef | undefined) ?? null;
  }

  /** Whether one document is shared with this visitor — checked before serving bytes. */
  async mayReadDocument(visitor: PortalVisitor, documentId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1
        FROM core.links l
       WHERE l.from_id = ${documentId}
         AND l.to_id = ${visitor.clientId}
         AND l.link_kind = 'shared_with_client'
       LIMIT 1
    `);
    return result.rows.length > 0;
  }
}
