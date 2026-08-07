import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { TimeService, type CreateEntryInput } from './time.service.js';

@Controller('time')
export class TimeController {
  constructor(private readonly time: TimeService) {}

  /** The day view — the primary entry screen. */
  @Get('day')
  day(
    @CurrentActor() actor: Actor,
    @Query('date') date?: string,
    @Query('personId') personId?: string,
  ) {
    return this.time.getDay(actor, { date, personId });
  }

  /** Week summary, read-only now that entries carry start/end and notes. */
  @Get('week')
  week(
    @CurrentActor() actor: Actor,
    @Query('weekOf') weekOf?: string,
    @Query('personId') personId?: string,
  ) {
    return this.time.getWeek(actor, { weekOf, personId });
  }

  /** Whatever clock is currently running, if any. */
  /** What you have been doing lately — the list under the clock on the tracker. */
  @Get('recent')
  recent(
    @CurrentActor() actor: Actor,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.time.getRecent(actor, { from, to });
  }

  /* ── Timesheet approval ────────────────────────────────────────────────── */

  /** Weeks waiting on a decision. Requires `time.approve`, so it is the approver's list. */
  @Get('approvals')
  approvals(@CurrentActor() actor: Actor) {
    return this.time.pendingWeeks(actor);
  }

  /** One week's state — mine by default, somebody else's with the right capability. */
  @Get('timesheet')
  timesheet(
    @CurrentActor() actor: Actor,
    @Query('weekOf') weekOf?: string,
    @Query('personId') personId?: string,
  ) {
    return this.time.timesheet(actor, { weekOf, personId });
  }

  @Post('timesheet/submit')
  submitWeek(@CurrentActor() actor: Actor, @Body() body: { weekOf?: string }) {
    return this.time.submitWeek(actor, body?.weekOf);
  }

  @Post('timesheet/decide')
  decideWeek(
    @CurrentActor() actor: Actor,
    @Body() body: { personId: string; weekOf: string; approve: boolean; note?: string },
  ) {
    return this.time.decideWeek(actor, body);
  }

  @Get('running')
  running(@CurrentActor() actor: Actor) {
    return this.time.getRunning(actor);
  }

  @Post('entries')
  create(@CurrentActor() actor: Actor, @Body() body: CreateEntryInput) {
    return this.time.createEntry(actor, body);
  }

  @Patch('entries/:id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: Partial<CreateEntryInput>,
  ) {
    return this.time.updateEntry(actor, id, body);
  }

  /** Stop the running entry (or a specific one). */
  @Post('entries/:id/stop')
  stop(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.time.stopEntry(actor, id);
  }

  @Post('stop')
  stopCurrent(@CurrentActor() actor: Actor) {
    return this.time.stopEntry(actor);
  }

  @Delete('entries/:id')
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.time.deleteEntry(actor, id);
    return { deleted: true };
  }

  /** Budget burn — the widget CRM's project page renders. */
  @Get('projects/:id/burn')
  burn(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.time.projectBurn(actor, id);
  }
}
