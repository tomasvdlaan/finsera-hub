import { Module, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { SalesModule } from '../sales/sales.module.js';
import { ScrumModule } from '../scrum/scrum.module.js';
import { PortalAuthController } from './portal-auth.controller.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalAdminController } from './portal-admin.controller.js';
import { PortalHostController } from './portal-host.controller.js';
import { PortalPagesService } from './portal-pages.service.js';
import { PortalHostService } from './portal-host.service.js';
import { PortalIdentityService } from './portal-identity.service.js';
import { PortalOidcService } from './portal-oidc.service.js';
import { PortalSessionsService } from './portal-sessions.service.js';
import { PortalPreviewController } from './portal-preview.controller.js';
import { PortalController } from './portal.controller.js';
import { PortalUsersService } from './portal-users.service.js';
import { portalManifest } from './portal.manifest.js';
import { PortalProjection } from './portal.projection.js';
import { PortalTicketsService } from './portal-tickets.service.js';

/**
 * The portal imports one module, and everything it reads comes from somewhere else.
 *
 * **Reads import nothing.** If this module held `BillingService`, the only thing between a
 * client and every invoice in the system would be remembering to pass the right filter.
 * Reads go through the published views instead, where the client id is a bound parameter
 * of every query that exists.
 *
 * **The writes import their owners.** Accepting a quote is a status transition
 * with an audit entry and a published event, and writing it here would create a second
 * answer to "is this quote accepted" that diverges the first time either side changes.
 * `SalesService.acceptByClient` takes no `Actor` — it cannot be handed an internal
 * identity, and it proves the quote belongs to the client id it was given. Scrum is here
 * for the same reason: a client request becomes a task through the module that owns
 * tasks, and only once an internal user has read it.
 */
@Module({
  imports: [SalesModule, ScrumModule, AuthModule],
  controllers: [
    PortalController,
    PortalAuthController,
    PortalHostController,
    PortalPreviewController,
    PortalAdminController,
  ],
  providers: [
    PortalProjection,
    PortalUsersService,
    PortalAuthGuard,
    PortalTicketsService,
    PortalHostService,
    PortalSessionsService,
    PortalOidcService,
    PortalIdentityService,
    PortalPagesService,
  ],
  exports: [
    PortalProjection,
    PortalUsersService,
    PortalTicketsService,
    PortalHostService,
    PortalSessionsService,
    PortalPagesService,
  ],
})
export class PortalModule implements OnModuleInit {
  constructor(private readonly manifests: ManifestRegistry) {}

  onModuleInit(): void {
    this.manifests.register(portalManifest);
  }
}
