import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { BillingService, type DraftLineInput } from './billing.service.js';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  list(
    @CurrentActor() actor: Actor,
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
  ) {
    return this.billing.listInvoices(actor, { clientId, status });
  }

  @Post('invoices/draft-from-hours')
  draftFromHours(@CurrentActor() actor: Actor, @Body() body: { projectId: string }) {
    return this.billing.draftFromHours(actor, body.projectId);
  }

  @Post('invoices')
  createDraft(
    @CurrentActor() actor: Actor,
    @Body()
    body: { clientId: string; projectId?: string; lines: DraftLineInput[]; notes?: string },
  ) {
    return this.billing.createDraft(actor, body);
  }

  @Get('invoices/:id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.billing.getInvoice(actor, id);
  }

  @Put('invoices/:id/lines')
  updateLines(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { lines: DraftLineInput[] },
  ) {
    return this.billing.updateDraftLines(actor, id, body.lines);
  }

  /** The legal moment: number allocated, VAT validated, row frozen. */
  @Post('invoices/:id/issue')
  issue(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.billing.issue(actor, id);
  }

  @Post('invoices/:id/mark-paid')
  markPaid(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.billing.markPaid(actor, id);
  }

  @Post('invoices/:id/credit-note')
  creditNote(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.billing.createCreditNote(actor, id);
  }

  @Delete('invoices/:id')
  async voidDraft(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.billing.voidDraft(actor, id);
    return { voided: true };
  }
}
