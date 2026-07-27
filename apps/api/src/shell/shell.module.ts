import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { ShellController } from './shell.controller.js';
import { TimelineService } from './timeline.service.js';

/**
 * Layer 3 — the application shell (backend side): navigation aggregation and the
 * core-assembled timeline. It composes what modules declared; it never imports them.
 *
 * Sealing manifests here (after every module's onModuleInit has run) is what turns a
 * collision into a startup failure rather than a runtime surprise.
 */
@Module({
  controllers: [ShellController],
  providers: [TimelineService],
  exports: [TimelineService],
})
export class ShellModule implements OnApplicationBootstrap {
  constructor(private readonly manifests: ManifestRegistry) {}

  onApplicationBootstrap(): void {
    this.manifests.seal();
  }
}
