import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { pageSecretsAvailable } from './page-secrets.js';
import { PortalPagesService, type PageInput } from './portal-pages.service.js';
import { PortalUsersService } from './portal-users.service.js';
import { ZitadelAdminService } from './zitadel-admin.service.js';

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
    private readonly zitadel: ZitadelAdminService,
  ) {}

  @Get('clients/:clientId/users')
  list(@CurrentActor() actor: Actor, @Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.users.listForClient(actor, clientId);
  }

  /**
   * Invite by email, and hand back a link to send them.
   *
   * The permission is written first and the Zitadel account second, in that order and not
   * the other way round. The invitation is the thing this platform owns and the thing that
   * survives: if the account cannot be created — no credential, Zitadel unreachable — the
   * row is still there, still claimable by a verified address the old way, and the response
   * says what did not happen instead of pretending the whole gesture failed.
   *
   * Still no mail from us. The link goes back to the screen, and a person sends it.
   */
  @Post('clients/:clientId/users')
  async invite(
    @CurrentActor() actor: Actor,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: { email?: string; displayName?: string },
  ) {
    const email = (body?.email ?? '').trim();
    const displayName = body?.displayName?.trim() || undefined;
    const created = await this.users.invite(actor, { clientId, email, displayName });
    return { ...created, ...(await this.provision(actor, created.id, email, displayName)) };
  }

  /**
   * A fresh link for an invitation that already exists.
   *
   * Zitadel invalidates the previous code when it issues a new one, so this is "the link is
   * lost or expired", never "send me a copy" — the screen says as much before it is pressed.
   */
  @Post('users/:id/invite-link')
  async inviteLink(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.users.byId(actor, id);
    if (row.disabledAt) {
      throw new BadRequestException('That access was revoked — restore it before sending a link');
    }
    return this.provision(actor, row.id, row.email, row.displayName ?? undefined);
  }

  /**
   * The Zitadel half: an account, the portal role, and a single-use link.
   *
   * Returns a `warning` rather than throwing, because everything the caller asked for that
   * this platform controls has already happened. A colleague reading "invited, but no link:
   * ZITADEL_ADMIN_TOKEN is not set" can act on it; a 503 over a completed invitation reads
   * as "nothing worked" and invites them to press the button again.
   */
  private async provision(
    actor: Actor,
    portalUserId: string,
    email: string,
    displayName?: string,
  ): Promise<{ invite: { url: string } | null; warning: string | null }> {
    if (!this.zitadel.configured) {
      return { invite: null, warning: this.zitadel.unconfiguredReason };
    }
    try {
      const invite = await this.zitadel.inviteToPortal({ email, displayName });
      await this.users.attachSubject(actor, portalUserId, invite.zitadelUserId);
      return { invite: { url: invite.url }, warning: null };
    } catch (err) {
      return { invite: null, warning: (err as Error).message };
    }
  }

  @Post('users/:id/revoke')
  revoke(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.revoke(actor, id);
  }

  /**
   * Release the account this invitation bound to, so it can bind again.
   *
   * The one repair that had no button. A portal login binds to a Zitadel account on first
   * sign-in and never rebinds, so when that account is replaced the row points at a subject
   * nobody has and every attempt reads as "no access" — indistinguishable from never having
   * been invited, and until now fixable only with a query against the database.
   */
  @Post('users/:id/unbind')
  unbind(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.unbind(actor, id);
  }

  @Post('users/:id/reinstate')
  reinstate(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.reinstate(actor, id);
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

  /**
   * The client's own logo, replaced or removed.
   *
   * Posted as base64 rather than multipart, matching how a pasted note image already
   * arrives here — one body parser, one size limit, one thing to reason about.
   */
  @Post('clients/:clientId/logo')
  setLogo(
    @CurrentActor() actor: Actor,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: { contentBase64?: string; mimeType?: string } | null,
  ) {
    return this.pages.setLogo(actor, clientId, body);
  }
}
