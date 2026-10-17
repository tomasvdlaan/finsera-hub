import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import { NotificationService } from '../core/notifications/notification.service.js';
import { PushRouter } from '../core/notifications/push-router.js';
import { PushService } from '../core/notifications/push.service.js';

/**
 * The Inbox's *For you*, for the person asking and nobody else. Every route reads or writes
 * only rows owned by the actor, so there is nothing here to permission beyond being signed in.
 */
@Controller('core/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly push: PushService,
    private readonly router: PushRouter,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.notifications.list(actor, n);
  }

  /** The badge. Cheap on purpose: the app asks every minute while it is open. */
  @Get('count')
  async count(@CurrentActor() actor: Actor) {
    return { unread: await this.notifications.count(actor) };
  }

  /** Mark the given entries read (each stands for its whole group), or — with no ids — all. */
  @Post('read')
  read(@CurrentActor() actor: Actor, @Body() body: { ids?: string[] }) {
    return this.notifications.markRead(actor, body?.ids);
  }

  @Get('settings')
  settings(@CurrentActor() actor: Actor) {
    return this.notifications.settings(actor.userId);
  }

  @Put('settings')
  saveSettings(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.notifications.saveSettings(actor, body);
  }

  /** Stop (or resume) comment notifications for one record. */
  @Post('mute')
  mute(@CurrentActor() actor: Actor, @Body() body: { subjectId?: string; muted?: boolean }) {
    if (!body?.subjectId) return this.notifications.settings(actor.userId);
    return this.notifications.mute(actor, body.subjectId, body.muted !== false);
  }

  /** Opened from a push on a device: counts as reading it, and as the push having worked. */
  @Post(':id/opened')
  async opened(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.router.opened(actor.userId, id);
    return { ok: true };
  }

  /** What a browser needs to subscribe — or `null`, and the page says push is not set up. */
  @Get('push/key')
  key() {
    return { publicKey: this.push.publicKey };
  }

  @Get('push/devices')
  devices(@CurrentActor() actor: Actor, @Query('endpoint') endpoint?: string) {
    return this.push.devices(actor, endpoint);
  }

  @Post('push/devices')
  register(
    @CurrentActor() actor: Actor,
    @Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; label?: string },
  ) {
    return this.push.register(actor, body);
  }

  /** Forget a device: by id from the list, or by endpoint when this browser signs out. */
  @Delete('push/devices')
  remove(@CurrentActor() actor: Actor, @Body() body: { id?: string; endpoint?: string }) {
    return this.push.remove(actor, body ?? {});
  }

  /**
   * A push straight away, past every rule — the only way to know it works is to see it arrive.
   */
  @Post('push/test')
  async test(@CurrentActor() actor: Actor) {
    return this.push.send(actor.userId, {
      id: null,
      title: 'Notifications work on this device.',
      url: '/settings/notifications',
      tag: 'test',
      badge: await this.notifications.count(actor),
    });
  }
}
