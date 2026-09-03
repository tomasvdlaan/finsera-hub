import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { pageSecretsAvailable } from './page-secrets.js';
import { PortalPagesService, type PageInput } from './portal-pages.service.js';
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
  constructor(
    private readonly users: PortalUsersService,
    private readonly pages: PortalPagesService,
  ) {}

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

  // ── custom content (Phase 8, step 3) ──

  /**
   * The pages a client has been given, and whether each can carry a bypass secret at all.
   *
   * `secretsAvailable` is on the list rather than discovered when a save fails: a form that
   * offers a field the server will refuse is a form that wastes somebody's afternoon.
   */
  @Get('clients/:clientId/pages')
  async pageList(@CurrentActor() actor: Actor, @Param('clientId', ParseUUIDPipe) clientId: string) {
    return {
      pages: await this.pages.list(actor, clientId),
      secretsAvailable: pageSecretsAvailable(),
    };
  }

  @Post('clients/:clientId/pages')
  createPage(
    @CurrentActor() actor: Actor,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: PageInput,
  ) {
    return this.pages.create(actor, clientId, body);
  }

  @Patch('pages/:id')
  updatePage(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<PageInput>,
  ) {
    return this.pages.update(actor, id, body);
  }

  @Delete('pages/:id')
  deletePage(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.pages.remove(actor, id);
  }

  /**
   * Ask the source whether it answers, from here.
   *
   * Worth a button because the three ways this goes wrong — no bypass secret, the wrong
   * one, or a URL that simply does not resolve — are indistinguishable from the client's
   * side, where all three are a page that does not load.
   */
  @Post('pages/:id/test')
  probePage(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.pages.probe(actor, id);
  }
}
