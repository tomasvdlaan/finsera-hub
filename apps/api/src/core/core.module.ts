import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service.js';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { EventBus } from './events/event-bus.service.js';
import { EventDispatcher } from './events/event-dispatcher.service.js';
import { EventHandlerRegistry } from './events/event-handler.registry.js';
import { LinkService } from './links/link.service.js';
import { ManifestRegistry } from './manifest/manifest.registry.js';
import { PermissionService } from './permissions/permission.service.js';
import { RegistryService } from './registry/registry.service.js';

/**
 * Layer 1 — the platform core. Owns identity and relationships; has no business logic.
 *
 * Remaining: llm/ (step 9). Everything else in the core is now in place.
 */
const services = [
  ManifestRegistry,
  RegistryService,
  AuditService,
  PermissionService,
  LinkService,
  EventBus,
  EventHandlerRegistry,
  EventDispatcher,
];

@Global()
@Module({
  imports: [DbModule, AuthModule],
  providers: services,
  exports: [DbModule, AuthModule, ...services],
})
export class CoreModule {}
