import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../core/auth/public.decorator.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { CurrentVisitor } from './current-visitor.decorator.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalProjection, type PortalVisitor } from './portal.projection.js';

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
  ) {}

  /**
   * Who the visitor is, from their session rather than from anything they sent.
   *
   * No client id: it would be an internal identifier of no use to them, and echoing it
   * back invites a front end to start passing it as a parameter — which is how a
   * server-side fact quietly becomes a client-supplied one.
   */
  @Get('me')
  me(@CurrentVisitor() visitor: PortalVisitor) {
    return { email: visitor.email };
  }

  @Get('projects')
  projects(@CurrentVisitor() visitor: PortalVisitor) {
    return this.projection.projects(visitor);
  }

  @Get('invoices')
  invoices(@CurrentVisitor() visitor: PortalVisitor) {
    return this.projection.invoices(visitor);
  }

  @Get('quotes')
  quotes(@CurrentVisitor() visitor: PortalVisitor) {
    return this.projection.quotes(visitor);
  }

  @Get('quotes/:id/lines')
  quoteLines(@CurrentVisitor() visitor: PortalVisitor, @Param('id', ParseUUIDPipe) id: string) {
    // Ownership is re-checked inside the query — the id came from the client, and the
    // list it was taken from is not evidence of anything.
    return this.projection.quoteLines(visitor, id);
  }

  @Get('documents')
  documents(@CurrentVisitor() visitor: PortalVisitor) {
    return this.projection.documents(visitor);
  }

  @Get('invoices/:id/pdf')
  async invoicePdf(
    @CurrentVisitor() visitor: PortalVisitor,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.projection.invoiceFile(visitor, id);
    // One 404 for "not yours", "not issued" and "no archived PDF" alike. Distinguishing
    // them would confirm to a stranger that an invoice with that id exists.
    if (!file) throw new NotFoundException('Not found');
    await this.send(res, file, 'inline');
  }

  @Get('documents/:id/download')
  async documentDownload(
    @CurrentVisitor() visitor: PortalVisitor,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.projection.documentFile(visitor, id);
    if (!file) throw new NotFoundException('Not found');
    await this.send(res, file, 'attachment');
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
    res.send(data);
  }
}
