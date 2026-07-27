import { Global, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { ManifestRegistry } from './manifest/manifest.registry.js';

/**
 * Layer 1 — the platform core. Owns identity and relationships; has no business logic.
 *
 * Remaining services land here in build steps 3–6 (spec §10):
 *   registry/ · links/ · events/ · permissions/ · llm/
 * Each is added to providers + exports as it is built.
 */
@Global()
@Module({
  imports: [DbModule, AuthModule],
  providers: [ManifestRegistry],
  exports: [DbModule, AuthModule, ManifestRegistry],
})
export class CoreModule {}
