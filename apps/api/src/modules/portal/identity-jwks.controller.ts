import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { Public } from '../../core/auth/public.decorator.js';
import { identityJwks } from './identity-token.js';

/**
 * The public key an artefact checks `x-finsera-identity` against.
 *
 * `@Public()` because the caller is a deployment on somebody else's infrastructure, and
 * because a public key is what it says. Cacheable for five minutes: long enough that an
 * artefact does not fetch it per request, short enough that a rotated key is picked up
 * before anybody notices the old one is gone.
 */
@Public()
@Controller('portal-identity')
export class IdentityJwksController {
  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  async jwks() {
    const jwks = await identityJwks();
    if (!jwks) throw new NotFoundException('Identity signing is not configured');
    return jwks;
  }
}
