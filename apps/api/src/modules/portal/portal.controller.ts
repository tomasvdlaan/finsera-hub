import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../../core/audit/audit.service.js';
import { Public } from '../../core/auth/public.decorator.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { SalesService } from '../sales/sales.service.js';
import { PortalTicketsService } from './portal-tickets.service.js';
import { CurrentViewer, CurrentVisitor } from './current-visitor.decorator.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalHostService } from './portal-host.service.js';
import { PortalPagesService } from './portal-pages.service.js';
import {
  PortalProjection,
  isStaff,
  type PortalViewer,
  type PortalVisitor,
} from './portal.projection.js';

/**
 * Everything a client can reach, and it is a short list.
 *
 * **On `@Public()`**, which looks alarming and is load-bearing. `AuthGuard` is registered
 * as an APP_GUARD, so without it every route here would demand an *internal* token and
 * the portal would be unusable. `@Public()` waives that guard specifically — and
 * `@UseGuards(PortalAuthGuard)` immediately reinstates a stricter one.
 *
 * The two must travel together. `@Public()` alone would leave these routes open to the
 * internet, and no test of the projection would notice, because the projection would be
 * doing exactly what it was asked. `portal.controller.spec.ts` asserts the pairing on the
 * controller class rather than trusting anyone to remember it.
 */
@Public()
@UseGuards(PortalAuthGuard)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly projection: PortalProjection,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
    private readonly tickets: PortalTicketsService,
    private readonly hosts: PortalHostService,
    private readonly portalPages: PortalPagesService,
    @Inject(DB) private readonly db: Database,
  ) {}

  /**
   * Who saw what, recorded for every read.
   *
   * Required by the phase brief (§4) and worth more here than internally: an internal
   * audit answers "who changed this", an external one answers "what did this client's
   * login see, and when" — which is the question asked after a dispute or a leaked
   * password, and it cannot be answered retrospectively.
   *
   * `actorId` is null because a portal visitor is not an internal user; the column is a
   * foreign key into `core.users` and putting a portal id there would be a lie the
   * database would reject anyway. The visitor is named in `detail`.
   */
  private async recordRead(viewer: PortalViewer, what: string, subject?: string) {
    const staff = isStaff(viewer);
    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        // A staff read has a real internal identity behind it, and the column is a foreign
        // key into `core.users`, so it can carry one. A client read cannot: a portal user
        // id there would be a lie the database would reject anyway.
        actorId: staff ? viewer.staffUserId : null,
        action: 'portal.read',
        entityType: 'client',
        entityId: viewer.clientId,
        detail: {
          read: what,
          ...(staff ? { staff: true } : { portalUserId: viewer.portalUserId }),
          email: viewer.email,
          ...(subject ? { subject } : {}),
        },
      });
    });
  }

  /**
   * Who the visitor is, from their session rather than from anything they sent.
   *
   * No client id: it would be an internal identifier of no use to them, and echoing it
   * back invites a front end to start passing it as a parameter — which is how a
   * server-side fact quietly becomes a client-supplied one.
   */
  @Get('me')
  async me(@CurrentViewer() viewer: PortalViewer, @Req() req: Request) {
    // The client's name only for a staff viewer, and only because the banner has to say
    // whose portal this is. A client already knows who they are, and echoing their client
    // id back would invite a front end to start passing it as a parameter — which is how a
    // server-side fact quietly becomes a client-supplied one.
    if (!isStaff(viewer)) return { email: viewer.email, staff: false };
    const host = req.portalHost ?? (await this.hosts.resolve(req.headers.host));
    return {
      email: viewer.email,
      staff: true,
      clientName: host?.kind === 'client' ? host.clientName : null,
    };
  }

  @Get('projects')
  async projects(@CurrentViewer() viewer: PortalViewer) {
    await this.recordRead(viewer, 'projects');
    return this.projection.projects(viewer);
  }

  /**
   * The work being done for them, for the projects they can already see.
   *
   * Read-only, and it stays read-only: a client moving a card would be a client editing a
   * board, and the board is where the work is actually planned.
   */
  @Get('tasks')
  async tasks(@CurrentViewer() viewer: PortalViewer) {
    await this.recordRead(viewer, 'tasks');
    return this.projection.tasks(viewer);
  }

  @Get('invoices')
  async invoices(@CurrentViewer() viewer: PortalViewer) {
    await this.recordRead(viewer, 'invoices');
    return this.projection.invoices(viewer);
  }

  @Get('quotes')
  async quotes(@CurrentViewer() viewer: PortalViewer) {
    await this.recordRead(viewer, 'quotes');
    return this.projection.quotes(viewer);
  }

  @Get('quotes/:id/lines')
  async quoteLines(@CurrentViewer() viewer: PortalViewer, @Param('id', ParseUUIDPipe) id: string) {
    await this.recordRead(viewer, 'quote_lines', id);
    // Ownership is re-checked inside the query — the id came from the client, and the
    // list it was taken from is not evidence of anything.
    return this.projection.quoteLines(viewer, id);
  }

  @Get('documents')
  async documents(@CurrentViewer() viewer: PortalViewer) {
    await this.recordRead(viewer, 'documents');
    return this.projection.documents(viewer);
  }

  @Get('invoices/:id/pdf')
  async invoicePdf(
    @CurrentViewer() viewer: PortalViewer,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    await this.recordRead(viewer, 'invoice_pdf', id);
    const file = await this.projection.invoiceFile(viewer, id);
    // One 404 for "not yours", "not issued" and "no archived PDF" alike. Distinguishing
    // them would confirm to a stranger that an invoice with that id exists.
    if (!file) throw new NotFoundException('Not found');
    await this.send(res, file, 'inline');
  }

  @Get('documents/:id/download')
  async documentDownload(
    @CurrentViewer() viewer: PortalViewer,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    await this.recordRead(viewer, 'document_download', id);
    const file = await this.projection.documentFile(viewer, id);
    if (!file) throw new NotFoundException('Not found');
    await this.send(res, file, 'attachment');
  }

  /**
   * The first thing a client can change, and the reason the read-only assertions in
   * `portal.controller.spec.ts` and `portal-preview.controller.spec.ts` were written.
   *
   * The work happens in `SalesService`, not here. Accepting a quote is a status
   * transition with an audit entry and a published event; reimplementing it against the
   * tables would create a second answer to "is this quote accepted", and the two would
   * diverge the first time either changed. The portal supplies who is asking and Sales
   * decides whether they may.
   *
   * Note what is NOT sent: nothing from the request body. Which quote comes from the path,
   * which client comes from the session. A body would be a place for a client id to
   * arrive from outside, and there is no such place.
   *
   * `@CurrentVisitor()` rather than `@CurrentViewer()`, and that is the whole staff rule
   * for this route: an employee looking at the portal cannot accept a quote, because
   * accepting is a statement by the client about a price (P5).
   */
  @Post('quotes/:id/accept')
  @HttpCode(200)
  async acceptQuote(
    @CurrentVisitor() visitor: PortalVisitor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.recordRead(visitor, 'quote_accept', id);
    return this.sales.acceptByClient({
      quoteId: id,
      clientId: visitor.clientId,
      portalUserId: visitor.portalUserId,
      email: visitor.email,
    });
  }

  /**
   * The custom content this client has been given — a title and a link each.
   *
   * Nothing about where it really comes from. The source URL is the thing the whole proxy
   * exists to keep out of the browser, and a list endpoint that leaked it would undo that
   * more quietly than anything else could.
   */
  @Get('pages')
  async pages(@CurrentViewer() viewer: PortalViewer) {
    await this.recordRead(viewer, 'pages');
    return this.portalPages.forClient(viewer.clientId);
  }

  /**
   * "Can you also…", which is the whole point of the form.
   *
   * The only free text the portal accepts, and the only place a client can put words into
   * our systems. It becomes a `portal.tickets` row rather than a task: see the schema for
   * why text written outside the business should not land on a board the assistant reads
   * without someone having looked at it first.
   *
   * `@CurrentVisitor()`, so an employee reading this portal cannot open a ticket as the
   * client. They answer from the inbox in the internal app instead (P5).
   */
  @Post('tickets')
  @HttpCode(201)
  async openTicket(
    @CurrentVisitor() visitor: PortalVisitor,
    @Body() body: { subject?: string; body?: string; projectId?: string },
  ) {
    await this.recordRead(visitor, 'ticket_open');
    return this.tickets.open(visitor, {
      subject: body?.subject ?? '',
      body: body?.body ?? '',
      projectId: body?.projectId,
    });
  }

  /** The client answering on their own ticket, which is what makes it a conversation. */
  @Post('tickets/:id/messages')
  @HttpCode(201)
  async replyToTicket(
    @CurrentVisitor() visitor: PortalVisitor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { body?: string },
  ) {
    await this.recordRead(visitor, 'ticket_reply', id);
    return this.tickets.replyAsClient(visitor, id, body?.body ?? '');
  }

  /** Their own tickets, so asking is not shouting into a void. */
  @Get('tickets')
  async tickets_(@CurrentViewer() viewer: PortalViewer) {
    await this.recordRead(viewer, 'tickets');
    return this.tickets.forClient(viewer);
  }

  /** One thread. Our internal notes on it are filtered out in the query, not here. */
  @Get('tickets/:id')
  async ticket(@CurrentViewer() viewer: PortalViewer, @Param('id', ParseUUIDPipe) id: string) {
    await this.recordRead(viewer, 'ticket', id);
    return this.tickets.threadForClient(viewer, id);
  }

  private async send(
    res: Response,
    file: { filename: string; mime_type: string; storage_key: string },
    disposition: 'inline' | 'attachment',
  ) {
    const data = await this.storage.get(file.storage_key);
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${file.filename.replace(/"/g, '')}"`,
    );
    // Nothing a client downloads should sit in a shared cache: these are one client's
    // invoices, served from a URL that differs only by id.
    res.setHeader('Cache-Control', 'private, no-store');
    // The content type comes from a stored `mime_type`, and an invoice PDF is served
    // inline. Without this a file whose recorded type is wrong could be sniffed into
    // something the browser executes on the client's own origin.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  }
}
