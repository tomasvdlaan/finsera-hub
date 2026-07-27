import { Module, type OnModuleInit } from '@nestjs/common';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { demoManifest } from './demo.manifest.js';

/**
 * THROWAWAY module — the reference pattern for Phase 1+. Delete after gate G0.
 *
 * Every module follows this shape: own schema, own service (its internal API),
 * own controller, and a manifest registered at bootstrap.
 */
@Module({
  providers: [],
  exports: [],
})
export class DemoModule implements OnModuleInit {
  constructor(private readonly manifests: ManifestRegistry) {}

  onModuleInit(): void {
    this.manifests.register(demoManifest);
  }
}
