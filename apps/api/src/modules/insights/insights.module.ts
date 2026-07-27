import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { InsightsController } from './insights.controller.js';
import { insightsManifest } from './insights.manifest.js';
import { InsightsScheduler } from './insights.scheduler.js';
import { InsightsService } from './insights.service.js';

/**
 * Insights imports no module. Like Reporting, it reads the published views through SQL —
 * which is what those views are for, and what keeps a service that observes everything
 * from depending on everything.
 */
@Module({
  controllers: [InsightsController],
  providers: [InsightsService, InsightsScheduler],
  exports: [InsightsService],
})
export class InsightsModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly insights: InsightsService,
  ) {}

  onModuleInit(): void {
    this.manifests.register(insightsManifest);
    this.aiTools.bind('insights_list', (actor: Actor, input) =>
      this.insights.list(actor, input as { status?: string; rule?: string }),
    );
  }
}
