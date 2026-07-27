import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service.js';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { ManifestRegistry } from './manifest/manifest.registry.js';
import { PermissionService } from './permissions/permission.service.js';
import { RegistryService } from './registry/registry.service.js';

/**
 * Layer 1 — the platform core. Owns identity and relationships; has no business logic.
 *
 * Remaining services land here in build steps 4–6 and 9 (spec §10):
 *   links/ · events/ · llm/
 */
@Global()
@Module({
  imports: [DbModule, AuthModule],
  providers: [ManifestRegistry, RegistryService, AuditService, PermissionService],
  exports: [
    DbModule,
    AuthModule,
    ManifestRegistry,
    RegistryService,
    AuditService,
    PermissionService,
  ],
})
export class CoreModule {}
