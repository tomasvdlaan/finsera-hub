import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { AuditService } from '../../core/audit/audit.service.js';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { PortalProjection } from './portal.projection.js';

/**
 * Seeing what a client sees, without being them.
 *
 * Three things make this safe enough to exist, and removing any one of them turns it into
 * the leak the rest of this module is built to prevent:
 *
 *   1. **It is not on the client-facing guard.** These routes authenticate as *internal*
 *      — the global `AuthGuard`, an internal token, the `internal` role. `PortalAuthGuard`
 *      is left strict, accepting only an invited client. Teaching that guard to also
 *      accept internal tokens would have been fewer lines and would have put the two
 *      audiences back in one place, which is the thing worth avoiding.
 *   2. **It requires `portal.admin`**, which is `adminOnly` — the same capability that
 *      grants a client access in the first place. Reading a client's portal and handing
 *      someone a login to it are the same kind of act.
 *   3. **Every read is audited**, with the client whose portal was opened. "Who looked at
 *      this client's invoices" is a question that gets asked afterwards, and the answer
 *      has to already exist.
 *
 * It reuses `PortalProjection` unchanged. That is the point: a preview built on its own
 * queries would drift, and a preview that does not match what the client sees is worse
 * than no preview, because it is believed.
 *
 * Read-only, and not by convention — `portal-preview.controller.spec.ts` fails if a
 * non-GET route ever appears here. When step 4 gives clients quote acceptance, previewing
 * must not be able to accept on their behalf.
 */
@Controller('portal-preview')
export class PortalPreviewController {
  private readonly logger = new Logger(PortalPreviewController.name);

  constructor(
    private readonly projection: PortalProjection,
    private readonly permissions: PermissionService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get(':clientId/projects')
  async projects(@CurrentActor() actor: Actor, @Param('clientId', ParseUUIDPipe) clientId: string) {
    await this.allow(actor, clientId, 'project');
    return this.projection.projects({ clientId });
  }

  @Get(':clientId/invoices')
  async invoices(@CurrentActor() actor: Actor, @Param('clientId', ParseUUIDPipe) clientId: string) {
    await this.allow(actor, clientId, 'invoice');
    return this.projection.invoices({ clientId });
  }

  @Get(':clientId/quotes')
  async quotes(@CurrentActor() actor: Actor, @Param('clientId', ParseUUIDPipe) clientId: string) {
    await this.allow(actor, clientId, 'quote');
    return this.projection.quotes({ clientId });
  }

  @Get(':clientId/quotes/:quoteId/lines')
  async quoteLines(
    @CurrentActor() actor: Actor,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ) {
    await this.allow(actor, clientId, 'quote_line');
    return this.projection.quoteLines({ clientId }, quoteId);
  }

  @Get(':clientId/documents')
  async documents(@CurrentActor() actor: Actor, @Param('clientId', ParseUUIDPipe) clientId: string) {
    await this.allow(actor, clientId, 'document');
    return this.projection.documents({ clientId });
  }

  @Get(':clientId/invoices/:invoiceId/pdf')
  async invoicePdf(
    @CurrentActor() actor: Actor,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Res() res: Response,
  ) {
    await this.allow(actor, clientId, 'invoice_pdf');
    const file = await this.projection.invoiceFile({ clientId }, invoiceId);
    if (!file) throw new NotFoundException('Not found');
    const data = await this.storage.get(file.storage_key);
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
  }

  /**
   * The capability check and the audit entry, together, on every read.
   *
   * Deliberately not a "start preview" endpoint that records once: a session that has to
   * be started can be skipped by calling the read endpoints directly, and then the audit
   * log says nothing while the data still flows. Auditing each read is noisier and cannot
   * be bypassed, and internal preview traffic is a person clicking, not a system polling.
   */
  private async allow(actor: Actor, clientId: string, what: string): Promise<void> {
    if (!(await this.permissions.can(actor, 'portal.admin'))) {
      this.logger.warn(`Portal preview refused for ${actor.userId}: missing portal.admin`);
      throw new ForbiddenException(`Missing capability 'portal.admin'`);
    }

    // A client id that matches nothing would otherwise return empty lists and read as
    // "this client has nothing", which is a different and misleading answer.
    const { rows } = await this.db.execute(
      sql`SELECT 1 FROM crm.clients WHERE id = ${clientId} LIMIT 1`,
    );
    if (rows.length === 0) throw new NotFoundException('No such client');

    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.previewed',
        entityType: 'client',
        entityId: clientId,
        detail: { read: what },
      });
    });
  }
}
