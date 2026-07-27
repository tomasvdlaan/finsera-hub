import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { EventHandlerRegistry } from '../../core/events/event-handler.registry.js';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
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
    private readonly aiTools: AiToolRegistry,
    private readonly demo: DemoService,
  ) {}

  onModuleInit(): void {
    this.manifests.register(demoManifest);
    this.handlers.bind('demo', 'onItemCreated', (ctx) => this.demo.onItemCreated(ctx));

    // Bind the tools the manifest declared. Writes made through the AI layer are
    // flagged in the audit trail — "who created this?" must stay answerable.
    this.aiTools.bind('demo_list_items', (actor: Actor, input) =>
      this.demo.listItems(actor, (input as { limit?: number }).limit ?? 10),
    );
    this.aiTools.bind('demo_create_item', (actor: Actor, input) =>
      this.demo.createItem(actor, input as { title: string; note?: string }, {
        aiInitiated: true,
      }),
    );
  }
}
