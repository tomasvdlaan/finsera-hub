import { Module, type OnModuleInit } from '@nestjs/common';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { SalesModule } from '../sales/sales.module.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalPreviewController } from './portal-preview.controller.js';
import { PortalController } from './portal.controller.js';
import { PortalUsersService } from './portal-users.service.js';
import { portalManifest } from './portal.manifest.js';
import { PortalProjection } from './portal.projection.js';

/**
 * The portal imports one module, and everything it reads comes from somewhere else.
 *
 * **Reads import nothing.** If this module held `BillingService`, the only thing between a
 * client and every invoice in the system would be remembering to pass the right filter.
 * Reads go through the published views instead, where the client id is a bound parameter
 * of every query that exists.
 *
 * **The single write imports Sales**, because accepting a quote is a status transition
 * with an audit entry and a published event, and writing it here would create a second
 * answer to "is this quote accepted" that diverges the first time either side changes.
 * `SalesService.acceptByClient` takes no `Actor` — it cannot be handed an internal
 * identity, and it proves the quote belongs to the client id it was given.
 */
@Module({
  imports: [SalesModule],
  controllers: [PortalController, PortalPreviewController],
  providers: [PortalProjection, PortalUsersService, PortalAuthGuard],
  exports: [PortalProjection, PortalUsersService],
})
export class PortalModule implements OnModuleInit {
  constructor(private readonly manifests: ManifestRegistry) {}

  onModuleInit(): void {
    this.manifests.register(portalManifest);
  }
}
