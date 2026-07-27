import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import {
  SalesService,
  type CreateQuoteInput,
  type QuoteLineInput,
} from './sales.service.js';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('quotes')
  list(
    @CurrentActor() actor: Actor,
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
  ) {
    return this.sales.listQuotes(actor, { clientId, status });
  }

  @Get('quotes/:id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.sales.getQuote(actor, id);
  }

  /** The stored original for sent quotes; a live CONCEPT render for drafts. */
  @Get('quotes/:id/pdf')
  async pdf(@CurrentActor() actor: Actor, @Param('id') id: string, @Res() res: Response) {
    const { filename, data } = await this.sales.getPdf(actor, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.send(data);
  }

  @Post('quotes')
  create(@CurrentActor() actor: Actor, @Body() body: CreateQuoteInput) {
    return this.sales.createDraft(actor, body);
  }

  @Patch('quotes/:id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: Partial<CreateQuoteInput>,
  ) {
    return this.sales.updateDraft(actor, id, body);
  }

  @Put('quotes/:id/lines')
  updateLines(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { lines: QuoteLineInput[] },
  ) {
    return this.sales.updateDraftLines(actor, id, body.lines);
  }

  @Delete('quotes/:id')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.sales.deleteDraft(actor, id);
  }

  /** The moment it becomes a promise: numbered, frozen, PDF filed. */
  @Post('quotes/:id/send')
  send(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.sales.send(actor, id);
  }

  @Post('quotes/:id/accept')
  accept(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { createProject?: boolean; attachToProjectId?: string },
  ) {
    return this.sales.accept(actor, id, body ?? {});
  }

  @Post('quotes/:id/reject')
  reject(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.sales.reject(actor, id, body?.reason);
  }

  /** A new draft superseding a sent quote — the original stays exactly as it was. */
  @Post('quotes/:id/revise')
  revise(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.sales.revise(actor, id);
  }
}
