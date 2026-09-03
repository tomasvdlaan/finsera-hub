import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_COOKIE, readCookie } from './cookies.js';
import { PortalHostService, type PortalHost } from './portal-host.service.js';
import { PortalSessionsService } from './portal-sessions.service.js';
import type { PortalViewer } from './portal.projection.js';

declare module 'express' {
  interface Request {
    viewer?: PortalViewer;
    portalHost?: PortalHost;
  }
}

/** The header every state-changing portal request must carry. A cross-site form cannot add it. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'portal';

/**
 * Turns the session cookie into a viewer, or refuses.
 *
 * What used to happen here — verifying a Zitadel token — now happens once at login in
 * `PortalIdentityService`. This guard's job is smaller and runs on every request:
 *
 *   1. There is a cookie, and it names a live session (not revoked, not expired, and its
 *      account still enabled — `PortalSessionsService.resolve` re-reads the user row every
 *      time, so revoking a login ends its sessions on the next request).
 *   2. **The host agrees with the session.** A session carries a client id: from the
 *      invitation row for a client, from the host it was created on for an employee. If
 *      the request arrived at a client host, that host must belong to the same client, or
 *      the answer is 403. The host never chooses the client — it can only disagree and
 *      lose. A cookie is scoped to one hostname anyway, so this is the second lock.
 *   3. A write carries the `X-Requested-With` header. `SameSite=Lax` already stops a
 *      cross-site form from sending the cookie on a POST in every current browser; the
 *      header is the second lock there, because a cookie-only rule is one browser quirk
 *      from open.
 *
 * What it does NOT decide is whether a staff viewer may do the thing being asked. That is
 * the difference between `@CurrentViewer()` and `@CurrentVisitor()` on the route itself:
 * reads take a viewer, writes take a visitor, and a staff session cannot satisfy the
 * second (P5).
 *
 * `req.actor` is never set: a portal request must never satisfy an internal guard, and
 * leaving that field unset is what makes an accidentally-shared controller fail closed.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: PortalSessionsService,
    private readonly hosts: PortalHostService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const host = await this.hosts.resolve(req.headers.host);
    /*
     * A client's data is served on a client's own host, and nowhere else.
     *
     * The login host resolves without consulting `crm.clients` at all — it is nobody's —
     * so a session held there would outlive the client being archived or their address
     * being cleared, because there would be no host to disagree with it. Refusing here is
     * what makes those two gestures actually end access: on a client host, `resolve()`
     * stops answering the moment either happens.
     */
    if (!host || host.kind !== 'client') throw new UnauthorizedException('No portal session');

    const secret = readCookie(req, SESSION_COOKIE);
    if (!secret) throw new UnauthorizedException('No portal session');

    const session = await this.sessions.resolve(secret);
    if (!session) throw new UnauthorizedException('No portal session');

    if (host.clientId !== session.clientId) {
      throw new ForbiddenException('Not your portal');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new ForbiddenException('Missing request header');
    }

    if (!session.email) throw new UnauthorizedException('No portal session');

    req.portalHost = host;
    req.viewer =
      session.kind === 'staff'
        ? { staffUserId: session.staffUserId!, clientId: session.clientId, email: session.email }
        : {
            portalUserId: session.portalUserId!,
            clientId: session.clientId,
            email: session.email,
          };
    return true;
  }
}
