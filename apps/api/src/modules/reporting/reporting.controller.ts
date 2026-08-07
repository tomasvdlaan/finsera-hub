import { Controller, Get, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import {
  ReportingService,
  currentMonth,
  currentYear,
  type Period,
} from './reporting.service.js';

@Controller('reporting')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  /** Everything the overview page needs, in one round trip. */
  @Get('overview')
  overview(@CurrentActor() actor: Actor) {
    return this.reporting.overview(actor);
  }

  @Get('revenue')
  revenue(@CurrentActor() actor: Actor, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reporting.revenue(actor, this.period(from, to, 'year'));
  }

  @Get('outstanding')
  outstanding(@CurrentActor() actor: Actor) {
    return this.reporting.outstanding(actor);
  }

  @Get('receivables')
  receivables(@CurrentActor() actor: Actor) {
    return this.reporting.receivables(actor);
  }

  @Get('unbilled')
  unbilled(@CurrentActor() actor: Actor) {
    return this.reporting.unbilled(actor);
  }

  @Get('utilisation')
  utilisation(
    @CurrentActor() actor: Actor,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reporting.utilisation(actor, this.period(from, to, 'month'));
  }

  @Get('project-profitability')
  profitability(@CurrentActor() actor: Actor) {
    return this.reporting.projectProfitability(actor);
  }

  @Get('pipeline')
  pipeline(@CurrentActor() actor: Actor, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reporting.pipeline(actor, from && to ? { from, to } : undefined);
  }

  @Get('renewals')
  renewals(@CurrentActor() actor: Actor, @Query('withinDays') withinDays?: string) {
    return this.reporting.renewals(actor, withinDays ? Number(withinDays) : 90);
  }

  private period(from: string | undefined, to: string | undefined, fallback: 'month' | 'year'): Period {
    if (from && to) return { from, to };
    return fallback === 'month' ? currentMonth() : currentYear();
  }
}
