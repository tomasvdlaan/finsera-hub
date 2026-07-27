import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { InsightsScheduler } from './insights.scheduler.js';
import { InsightsService } from './insights.service.js';

@Controller('insights')
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly scheduler: InsightsScheduler,
  ) {}

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query('status') status?: string,
    @Query('rule') rule?: string,
  ) {
    return this.insights.list(actor, { status, rule });
  }

  @Get('summary')
  summary(@CurrentActor() actor: Actor) {
    return this.insights.summary(actor);
  }

  /** Manual refresh — the same idempotent sweep the timer runs. */
  @Post('refresh')
  async refresh(@CurrentActor() actor: Actor) {
    await this.insights.list(actor, {}); // permission check before doing work
    await this.scheduler.run();
    return this.insights.summary(actor);
  }

  @Post(':id/dismiss')
  dismiss(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.insights.dismiss(actor, id);
  }

  @Post(':id/restore')
  restore(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.insights.restore(actor, id);
  }
}
