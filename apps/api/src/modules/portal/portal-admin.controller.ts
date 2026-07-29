import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { PortalUsersService } from './portal-users.service.js';

/**
 * Giving a client access, and taking it away.
 *
 * Internal, on the ordinary `AuthGuard`, and every method behind `portal.admin` — which is
 * `adminOnly`, because this is the one capability that hands data to someone outside the
 * business. The service enforces that; this controller only routes.
 *
 * Separate from `PortalPreviewController` because these are different acts. Previewing is
 * looking at what a client sees; this is deciding who may. They share a capability, not a
 * purpose, and a controller that did both would invite a GET-only assertion to be written
 * for one half and quietly not hold for the other.
 */
@Controller('portal-admin')
export class PortalAdminController {
  constructor(private readonly users: PortalUsersService) {}

  @Get('clients/:clientId/users')
  list(@CurrentActor() actor: Actor, @Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.users.listForClient(actor, clientId);
  }

  /**
   * Invite by email. The subject binds itself on first sign-in.
   *
   * No email is sent from here — the client needs a Zitadel account either way, and a
   * second invitation mail from us would be a second thing to keep true. What this creates
   * is the permission; telling them about it is a conversation.
   */
  @Post('clients/:clientId/users')
  invite(
    @CurrentActor() actor: Actor,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: { email?: string; displayName?: string },
  ) {
    return this.users.invite(actor, {
      clientId,
      email: (body?.email ?? '').trim(),
      displayName: body?.displayName?.trim() || undefined,
    });
  }

  @Post('users/:id/revoke')
  revoke(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.revoke(actor, id);
  }
}
