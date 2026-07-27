import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { ReportingController } from './reporting.controller.js';
import { reportingManifest } from './reporting.manifest.js';
import { ReportingService, currentMonth, type Period } from './reporting.service.js';

/**
 * Reporting. Imports no other module: it reads their published views through SQL, which
 * is the contract those views exist to be. Nothing here can write.
 */
@Module({
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly reporting: ReportingService,
  ) {}

  onModuleInit(): void {
    this.manifests.register(reportingManifest);

    const period = (input: unknown): Period => {
      const p = input as Partial<Period>;
      return p.from && p.to ? { from: p.from, to: p.to } : currentMonth();
    };

    this.aiTools.bind('reporting_revenue', (actor: Actor, input) =>
      this.reporting.revenue(actor, period(input)),
    );
    this.aiTools.bind('reporting_outstanding', (actor: Actor) =>
      this.reporting.outstanding(actor),
    );
    this.aiTools.bind('reporting_unbilled', (actor: Actor) => this.reporting.unbilled(actor));
    this.aiTools.bind('reporting_utilisation', (actor: Actor, input) =>
      this.reporting.utilisation(actor, period(input)),
    );
    this.aiTools.bind('reporting_project_profitability', (actor: Actor) =>
      this.reporting.projectProfitability(actor),
    );
    this.aiTools.bind('reporting_pipeline', (actor: Actor, input) => {
      const p = input as Partial<Period>;
      return this.reporting.pipeline(actor, p.from && p.to ? { from: p.from, to: p.to } : undefined);
    });
    this.aiTools.bind('reporting_renewals', (actor: Actor, input) =>
      this.reporting.renewals(actor, (input as { withinDays?: number }).withinDays ?? 90),
    );
  }
}
