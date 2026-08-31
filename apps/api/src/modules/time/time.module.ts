import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { CrmModule } from '../crm/crm.module.js';
import { TimeController } from './time.controller.js';
import { timeManifest } from './time.manifest.js';
import { TimeService, type CreateEntryInput } from './time.service.js';

/**
 * Time Registration — the first module that depends on another.
 *
 * It imports CrmModule to reach CrmService, CRM's published API. The dependency runs
 * one way only (Time → CRM); keeping that graph acyclic is what lets either module be
 * replaced later.
 */
@Module({
  imports: [CrmModule],
  controllers: [TimeController],
  providers: [TimeService],
  exports: [TimeService],
})
export class TimeModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly time: TimeService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(timeManifest);
    await this.time.ensureReportingViews();

    this.aiTools.bind('time_get_week', (actor: Actor, input) =>
      this.time.getWeek(actor, input as { weekOf?: string }),
    );
    this.aiTools.bind('time_project_hours', (actor: Actor, input) =>
      this.time.projectBurn(actor, (input as { projectId: string }).projectId),
    );
    this.aiTools.bind('time_get_day', (actor: Actor, input) =>
      this.time.getDay(actor, input as { date?: string }),
    );
    this.aiTools.bind('time_log_hours', (actor: Actor, input) =>
      this.time.createEntry(actor, input as CreateEntryInput, { aiInitiated: true }),
    );
    this.aiTools.bind('time_stop_timer', (actor: Actor, input) =>
      this.time.stopEntry(actor, undefined, input as { minutes?: number }),
    );
  }
}
