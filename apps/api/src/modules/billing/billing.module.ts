import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { CrmModule } from '../crm/crm.module.js';
import { TimeModule } from '../time/time.module.js';
import { BillingController } from './billing.controller.js';
import { billingManifest } from './billing.manifest.js';
import { BillingService } from './billing.service.js';

/**
 * Invoicing. Depends on CRM (client billing data, project rates) and Time (the hours
 * being billed) — both through their services, and both one-way.
 */
@Module({
  imports: [CrmModule, TimeModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly billing: BillingService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(billingManifest);
    await this.billing.ensureReportingViews();

    this.aiTools.bind('billing_list_invoices', (actor: Actor, input) =>
      this.billing.listInvoices(actor, input as { clientId?: string; status?: string }),
    );
    this.aiTools.bind('billing_draft_from_hours', (actor: Actor, input) =>
      this.billing.draftFromHours(actor, (input as { projectId: string }).projectId, {
        aiInitiated: true,
      }),
    );
    // billing_send_invoice is deliberately NOT bound: restricted tools are never offered
    // to the assistant, and there is no send implementation for it to reach yet either.
  }
}
