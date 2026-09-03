import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { Public } from '../../core/auth/public.decorator.js';
import { PortalHostService } from './portal-host.service.js';

/**
 * The question Caddy asks before it will get a certificate for a hostname.
 *
 * On-demand TLS means every client portal appears the moment a slug is set — no Caddyfile
 * edit, no restart, no wildcard certificate to renew. It also means anything that resolves
 * to this server could ask for a certificate in its own name, and Let's Encrypt counts
 * those against a weekly limit. So Caddy is configured to ask first, and this answers:
 * 200 for a host that is a client's portal or the login host, 404 for everything else.
 *
 * `@Public()` because it is called by the reverse proxy on the way to a TLS handshake,
 * before any session could exist. It discloses only whether a name is a portal — which is
 * exactly what opening the name in a browser would tell you anyway.
 */
@Public()
@Controller('portal-host')
export class PortalHostController {
  constructor(private readonly hosts: PortalHostService) {}

  @Get('check')
  async check(@Query('domain') domain?: string, @Query('t') token?: string) {
    /*
     * Only from the reverse proxy, when a shared token is configured.
     *
     * Caddy reaches this over the container network; anyone else reaching it could
     * enumerate which client slugs exist, one guess at a time. That is roughly what probing
     * the hostnames themselves would tell them, which is why this is a token rather than a
     * refusal to answer — but a listable directory of a firm's clients is worth not
     * publishing.
     *
     * In the query string because Caddy's `ask` sends no custom headers; it appends
     * `domain` to whatever URL it is given, so a `?t=` already on it survives. Unset means
     * unrestricted, so a deployment that has not set one keeps issuing certificates rather
     * than silently losing them the day this ships.
     */
    const expected = process.env.PORTAL_ASK_TOKEN;
    if (expected && token !== expected) throw new NotFoundException('Not found');

    const host = await this.hosts.resolve(domain);
    // Caddy reads the status, not the body. The body is for whoever curls this by hand
    // while wondering why a certificate was not issued.
    if (!host) throw new NotFoundException(`${domain ?? 'that host'} is not a portal address`);
    return { host: host.host, kind: host.kind };
  }
}
