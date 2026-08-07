import { Module, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { AssistantController } from './assistant.controller.js';
import { coreManifest } from './shell.manifest.js';
import { SearchService } from './search.service.js';
import { ShellController } from './shell.controller.js';
import { DashboardService } from '../core/registry/dashboard.service.js';
import { TimelineService, type RecentQuery } from './timeline.service.js';

/**
 * Layer 3 — the application shell (backend side): navigation aggregation and the
 * core-assembled timeline. It composes what modules declared; it never imports them.
 *
 * Sealing manifests here (after every module's onModuleInit has run) is what turns a
 * collision into a startup failure rather than a runtime surprise.
 */
@Module({
  controllers: [ShellController, AssistantController],
  providers: [TimelineService, SearchService, DashboardService],
  exports: [TimelineService],
})
export class ShellModule implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly timeline: TimelineService,
  ) {}

  /*
   * Registered here, and before the seal below.
   *
   * The core's own tools have to be declared somewhere the tool registry can find them, and
   * the shell is the only place that knows about the core without knowing about any module.
   */
  onModuleInit(): void {
    this.manifests.register(coreManifest);

    // Bound by TOOL name, not by the manifest's `handler` string — the handler field is
    // documentation, and binding to it means the registry never finds an executor and drops
    // the tool with a per-request warning nobody is reading.
    this.aiTools.bind('activity_recent', (actor: Actor, input) =>
      this.timeline.recent(actor, input as RecentQuery),
    );
    this.aiTools.bind('activity_for', (actor: Actor, input) => {
      const { entityId, limit } = input as { entityId: string; limit?: number };
      return this.timeline.for(actor, entityId, limit);
    });
  }

  onApplicationBootstrap(): void {
    this.manifests.seal();

    /*
     * A declared tool with nothing behind it is a bug, so it stops the server.
     *
     * The registry already warns about this — once per request, inside a log line nobody
     * reads, while the assistant quietly answers as though the capability does not exist.
     * That is exactly how `activity_recent` shipped bound to the wrong name and spent three
     * conversations insisting the platform had no activity feed.
     *
     * Here rather than in `seal()` because the manifest registry knows what was declared and
     * the tool registry knows what was bound, and this is the one place that has both.
     */
    const unbound = this.manifests
      .aiTools()
      // Restricted tools are exempt, and deliberately so: the registry drops them before it
      // ever looks for an executor, so binding one would be dead code. They are declared to
      // record that the capability exists and that the assistant may not have it —
      // `billing_send_invoice` and `sales_send_quote` are both this, and both should stay
      // unbound.
      .filter((t) => t.riskClass !== 'restricted' && !this.aiTools.isBound(t.name))
      .map((t) => `${t.name} (${t.module})`);
    if (unbound.length > 0) {
      throw new Error(
        `AI tools declared but never bound: ${unbound.join(', ')}. ` +
          'Bind them by tool name in the owning module, or remove the declaration.',
      );
    }
  }
}
