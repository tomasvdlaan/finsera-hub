import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import { NotificationService } from '../core/notifications/notification.service.js';

/**
 * The Inbox's *For you*, for the person asking and nobody else. Every route reads or writes
 * only rows owned by the actor, so there is nothing here to permission beyond being signed in.
 */
@Controller('core/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

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
}
