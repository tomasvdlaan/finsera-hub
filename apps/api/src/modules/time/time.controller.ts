import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { TimeService, type LogHoursInput } from './time.service.js';

@Controller('time')
export class TimeController {
  constructor(private readonly time: TimeService) {}

  /** The week grid's only read. */
  @Get('week')
  week(
    @CurrentActor() actor: Actor,
    @Query('weekOf') weekOf?: string,
    @Query('personId') personId?: string,
  ) {
    return this.time.getWeek(actor, { weekOf, personId });
  }

  /** Set one cell. Zero deletes, so clearing is the same gesture as typing over. */
  @Post('cell')
  setCell(
    @CurrentActor() actor: Actor,
    @Body() body: { projectId: string; workedOn: string; minutes: number; personId?: string },
  ) {
    return this.time.setCell(actor, body);
  }

  @Post('entries')
  log(@CurrentActor() actor: Actor, @Body() body: LogHoursInput) {
    return this.time.logHours(actor, body);
  }

  @Delete('entries/:id')
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.time.deleteEntry(actor, id);
    return { deleted: true };
  }

  @Post('submit')
  submit(@CurrentActor() actor: Actor, @Body() body: { weekOf: string; personId?: string }) {
    return this.time.submitWeek(actor, body.weekOf, body.personId);
  }

  @Post('reopen')
  reopen(@CurrentActor() actor: Actor, @Body() body: { weekOf: string; personId?: string }) {
    return this.time.reopenWeek(actor, body.weekOf, body.personId);
  }

  @Get('unsubmitted')
  unsubmitted(@CurrentActor() actor: Actor) {
    return this.time.unsubmittedWeeks(actor);
  }

  /** Budget burn for a project — the widget CRM's project page renders. */
  @Get('projects/:id/burn')
  burn(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.time.projectBurn(actor, id);
  }
}
