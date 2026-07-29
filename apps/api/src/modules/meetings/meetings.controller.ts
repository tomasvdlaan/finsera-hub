import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { LiveRunner } from './live/live-runner.service.js';
import { MeetingsService, type CreateNoteInput } from './meetings.service.js';
import { TEMPLATE_LIST } from './templates.js';

@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly live: LiveRunner,
  ) {}

  // ── the live agent ──

  /**
   * Send a bot to a meeting.
   *
   * Consent is checked before the bot travels, not when its audio arrives — by then it
   * would already have sat in the client's meeting.
   */
  @Post(':id/live/start')
  startLive(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { meetingUrl: string },
  ) {
    return this.live.startBot(actor, id, body.meetingUrl);
  }

  /** Is a session still running? Lets a reloaded page rejoin rather than start again. */
  @Get(':id/live')
  liveStatus(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.live.status(id);
  }

  /** What the meeting agent can do. Shown in the UI and the platform documentation. */
  @Get('behaviours')
  behaviours() {
    return this.live.listBehaviours();
  }

  /** Turn behaviours on or off, and decide whether any of them may speak. */
  @Post(':id/live/behaviours')
  configureBehaviours(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { enabled?: string[]; maySpeak?: boolean },
  ) {
    const settings = this.live.configure(id, body);
    return { enabled: [...settings.enabled], maySpeak: settings.maySpeak };
  }

  /** Let the bot talk back. Off by default; this is the testing switch. */
  @Post(':id/live/chatty')
  setChatty(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { on: boolean },
  ) {
    this.live.setChatty(id, body.on);
    return { noteId: id, chatty: this.live.isChatty(id) };
  }

  @Post(':id/live/stop')
  stopLive(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.live.stop(actor, id);
  }

  @Get('templates')
  templates() {
    return TEMPLATE_LIST;
  }

  @Get('search')
  search(@CurrentActor() actor: Actor, @Query('q') q = '', @Query('limit') limit?: string) {
    return this.meetings.search(actor, q, limit ? Number(limit) : 10);
  }

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.meetings.list(actor, { clientId, projectId });
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.meetings.get(actor, id);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() body: CreateNoteInput) {
    return this.meetings.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: Partial<CreateNoteInput>,
  ) {
    return this.meetings.update(actor, id, body);
  }

  @Post(':id/finalise')
  finalise(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.meetings.finalise(actor, id);
  }

  @Delete(':id')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.meetings.remove(actor, id);
  }

  // ── agenda ──

  @Post(':id/agenda')
  addAgenda(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: { title: string }) {
    return this.meetings.addAgendaItem(actor, id, body.title);
  }

  @Post(':id/agenda/:itemId/covered')
  setCovered(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { covered: boolean },
  ) {
    return this.meetings.setAgendaCovered(actor, id, itemId, body.covered);
  }

  @Delete(':id/agenda/:itemId')
  removeAgenda(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.meetings.removeAgendaItem(actor, id, itemId);
  }

  // ── attendees ──

  @Post(':id/attendees')
  addAttendee(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { name: string; email?: string; contactId?: string },
  ) {
    return this.meetings.addAttendee(actor, id, body);
  }

  /** Recorded and audited: "they agreed" is worth nothing without when and by whom. */
  @Post(':id/attendees/:attendeeId/consent')
  setConsent(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
    @Body() body: { consent: 'granted' | 'declined' },
  ) {
    return this.meetings.setConsent(actor, id, attendeeId, body.consent);
  }

  @Delete(':id/attendees/:attendeeId')
  removeAttendee(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
  ) {
    return this.meetings.removeAttendee(actor, id, attendeeId);
  }

  // ── action points ──

  @Post(':id/actions')
  addAction(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { text: string; assigneeId?: string; dueOn?: string },
  ) {
    return this.meetings.addActionItem(actor, id, body);
  }

  @Post(':id/actions/:itemId/accept')
  acceptAction(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.meetings.acceptActionItem(actor, id, itemId);
  }

  @Post(':id/actions/:itemId/dismiss')
  dismissAction(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.meetings.dismissActionItem(actor, id, itemId);
  }
}
