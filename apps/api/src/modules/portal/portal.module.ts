import { Module, type OnModuleInit } from '@nestjs/common';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalController } from './portal.controller.js';
import { PortalUsersService } from './portal-users.service.js';
import { portalManifest } from './portal.manifest.js';
import { PortalProjection } from './portal.projection.js';

/**
 * The portal imports no module, and that is a security property rather than tidiness.
 *
 * Every other module reads its neighbours through their services. If this one did the
 * same, a portal request would hold a reference to `BillingService` — and the only thing
 * standing between a client and every invoice in the system would be remembering to pass
 * the right filter. Instead it reads the published views through SQL, where the client id
 * is a bound parameter of every query that exists.
 */
@Module({
  controllers: [PortalController],
  providers: [PortalProjection, PortalUsersService, PortalAuthGuard],
  exports: [PortalProjection, PortalUsersService],
})
export class PortalModule implements OnModuleInit {
  constructor(private readonly manifests: ManifestRegistry) {}

  onModuleInit(): void {
    this.manifests.register(portalManifest);
  }
}
