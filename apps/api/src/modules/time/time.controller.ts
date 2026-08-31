import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import type { Response } from 'express';
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
    @Query('everyone') everyone?: string,
    /*
     * One named person, for the page that is about them.
     *
     * `getRecent` has accepted `personId` since it was written and no route ever passed it, so
     * the only reachable answers were "mine" and "everybody's". It already requires
     * `time.entries.read_all` whenever the id is not the caller's own, which is now admin-only
     * — so this widens the API's surface without widening what anybody can see.
     */
    @Query('personId') personId?: string,
  ) {
    return this.time.getRecent(actor, { from, to, personId, everyone: everyone === 'true' });
  }

  /**
   * Hours, as a file.
   *
   * Streams rather than returns JSON, the same way the invoice UBL export does — the caller is
   * a person clicking a button who wants a file in their downloads, not a client parsing a
   * body. `Content-Disposition: attachment` is what makes the browser save it instead of
   * rendering a wall of semicolons.
   *
   * `personId=all` is the whole team; omitting it means your own hours. Both are governed in
   * the service, on the capability that actually decides it.
   */
  @Get('export')
  async export(
    @CurrentActor() actor: Actor,
    @Res() res: Response,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('personId') personId?: string,
    @Query('shape') shape?: string,
    @Query('costs') costs?: string,
  ) {
    const { filename, csv } = await this.time.exportHours(actor, {
      from,
      to,
      personId,
      shape,
      costs: costs === 'true',
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.send(csv);
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
  stop(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body?: { minutes?: number },
  ) {
    return this.time.stopEntry(actor, id, { minutes: body?.minutes });
  }

  /** `minutes` corrects a clock that ran too long to be saved as elapsed — see stopEntry. */
  @Post('stop')
  stopCurrent(@CurrentActor() actor: Actor, @Body() body?: { minutes?: number }) {
    return this.time.stopEntry(actor, undefined, { minutes: body?.minutes });
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
