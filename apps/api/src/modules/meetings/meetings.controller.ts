import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../../core/storage/storage.service.js';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { Public } from '../../core/auth/public.decorator.js';
import { LiveRunner } from './live/live-runner.service.js';
import { MeetingsService, type CreateNoteInput } from './meetings.service.js';
import { TEMPLATE_LIST } from './templates.js';

/**
 * A storage key that is safe to read.
 *
 * Keys are random paths chosen at upload, so a malformed one means someone is trying it
 * on. Checked rather than trusted: without this, `../../` in the path would read anything
 * the process can.
 */
export function safeStorageKey(key: string | string[]): string {
  const joined = Array.isArray(key) ? key.join('/') : key;
  const decoded = decodeURIComponent(joined);
  if (!decoded || decoded.includes('..') || decoded.startsWith('/') || decoded.includes('\\')) {
    throw new BadRequestException('Bad image key');
  }
  return decoded;
}

function mimeFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    }[ext ?? ''] ?? 'application/octet-stream'
  );
}

@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly live: LiveRunner,
    private readonly storage: StorageService,
  ) {}

  // ── images in notes ──

  /**
   * Store an image pasted or dropped into a note.
   *
   * Deliberately NOT a Document: a screenshot pasted mid-sentence is part of the note,
   * not a filed record, and turning every one into a document would bury the contracts
   * and invoices that belong there. The bytes still land in the same storage tree, so
   * the nightly backup covers them either way.
   */
  @Post('images')
  async uploadImage(
    @CurrentActor() actor: Actor,
    @Body() body: { filename?: string; mimeType?: string; contentBase64?: string },
  ) {
    if (!body?.contentBase64) throw new BadRequestException('contentBase64 is required');
    if (!body.mimeType?.startsWith('image/')) {
      throw new BadRequestException('Only images can be inserted into a note');
    }

    const data = Buffer.from(body.contentBase64, 'base64');
    if (data.length === 0) throw new BadRequestException('Empty image');
    if (data.length > 10 * 1024 * 1024) throw new BadRequestException('Images are limited to 10 MB');

    const stored = await this.storage.put(data, body.filename ?? 'pasted-image');
    return { url: `/api/meetings/images/${encodeURIComponent(stored.key)}`, key: stored.key };
  }

  /**
   * Serve a note image.
   *
   * Unauthenticated, and that is a trade rather than an oversight.
   *
   * An `<img src>` cannot carry an Authorization header, so while this route sat behind the
   * guard *every image pasted into a note rendered as a broken icon* — the upload succeeded,
   * the Markdown was correct, and the picture was unreachable by the only element that can
   * display it. The alternatives are worse in practice: fetching each image as a blob needs
   * bespoke handling everywhere Markdown is rendered, and signed URLs need an expiry a note
   * kept for two years will outlive.
   *
   * What makes it acceptable is that the key is unguessable — `randomUUID()` chosen at
   * upload, never derived from the filename, the note or anything an outsider can see.
   * Knowing the URL is the permission: there is nothing to enumerate and no id to increment.
   * The exposure is a leaked URL, the same as any capability link.
   *
   * The key is still checked rather than trusted, and the response is locked down: these
   * bytes were uploaded by whoever can write a note, and an SVG served inline can carry
   * script, so the CSP denies it everything and `nosniff` stops a mislabelled file being
   * reinterpreted as one.
   */
  @Public()
  @Get('images/*key')
  async image(@Param('key') key: string, @Res() res: Response) {
    const safe = safeStorageKey(key);
    if (!(await this.storage.exists(safe))) throw new BadRequestException('Unknown image');

    const data = await this.storage.get(safe);
    res.setHeader('Content-Type', mimeFromKey(safe));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A leaked URL a crawler has indexed is a worse problem than a leaked URL.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(data);
  }

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

  /**
   * Rebuild a note's search chunks from its body.
   *
   * Needed after the transcript backfill, which deleted chunks embedded with speech in
   * them rather than calling a model from a migration script. Useful on its own whenever
   * indexing has fallen behind — it is idempotent, and it replaces rather than appends.
   */
  @Post(':id/reindex')
  async reindex(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return { chunks: await this.meetings.reindex(actor, id) };
  }

  /** Every action point still waiting for a decision, across every meeting. */
  @Get('open-actions')
  openActions(@CurrentActor() actor: Actor) {
    return this.meetings.openActions(actor);
  }

  /** What is being recorded right now, whichever tab or bot started it. */
  @Get('live')
  activeSessions() {
    return this.live.active();
  }

  /** What was said, per recording. Its own route because it is the largest thing here. */
  @Get(':id/transcripts')
  transcripts(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.meetings.listTranscripts(actor, id);
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

  /** Attach this note to a sprint — used by planning the moment it creates one. */
  @Post(':id/sprint')
  linkSprint(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { sprintId: string },
  ) {
    return this.meetings.linkToSprint(actor, id, body.sprintId);
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

  /** Who owns it and when it is due — settable only while it is still a proposal. */
  @Patch(':id/actions/:itemId')
  updateAction(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { assigneeId?: string | null; dueOn?: string | null },
  ) {
    return this.meetings.updateActionItem(actor, id, itemId, body);
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
