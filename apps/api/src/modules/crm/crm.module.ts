import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { CrmController } from './crm.controller.js';
import { crmManifest } from './crm.manifest.js';
import { CrmService, type CreateProjectInput } from './crm.service.js';

/**
 * The CRM module — master data for the whole platform.
 *
 * Same shape the walking skeleton established: own schema, own service (its internal
 * API), own controller, a manifest registered at bootstrap, and declared AI tools bound
 * to real functions.
 */
@Module({
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly crm: CrmService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(crmManifest);

    // Reporting views are part of the module's published contract, so they are created
    // with the module rather than hand-applied later (roadmap principle 4).
    await this.crm.ensureReportingViews();

    this.aiTools.bind('crm_search_clients', (actor: Actor, input) =>
      this.crm.searchClients(actor, input as { query?: string; limit?: number }),
    );
    this.aiTools.bind('crm_get_client_overview', (actor: Actor, input) =>
      this.crm.getClientOverview(actor, (input as { clientId: string }).clientId),
    );
    this.aiTools.bind('crm_list_projects', (actor: Actor, input) =>
      this.crm.listProjects(actor, input as { clientId?: string; status?: string }),
    );
    this.aiTools.bind('crm_create_lead', (actor: Actor, input) =>
      this.crm.createLead(actor, input as { name: string; website?: string; notes?: string }),
    );
    this.aiTools.bind('crm_create_project', (actor: Actor, input) =>
      this.crm.createProjectViaAi(actor, input as CreateProjectInput),
    );
  }
}
