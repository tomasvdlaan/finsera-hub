import { Module, type OnModuleInit } from '@nestjs/common';
import { EventHandlerRegistry } from '../../core/events/event-handler.registry.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { DemoController } from './demo.controller.js';
import { demoManifest } from './demo.manifest.js';
import { DemoService } from './demo.service.js';

/**
 * THROWAWAY module — the reference pattern for Phase 1+. Delete after gate G0.
 *
 * Every module follows this shape: own schema, own service (its internal API), own
 * controller, a manifest registered at bootstrap, and its declared event handlers bound
 * to real functions.
 */
@Module({
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly handlers: EventHandlerRegistry,
    private readonly demo: DemoService,
  ) {}

  onModuleInit(): void {
    this.manifests.register(demoManifest);
    this.handlers.bind('demo', 'onItemCreated', (ctx) => this.demo.onItemCreated(ctx));
  }
}
