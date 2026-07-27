import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { CrmModule } from '../crm/crm.module.js';
import { DocsModule } from '../docs/docs.module.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService, type CreateContractInput } from './contracts.service.js';
import { SalesController } from './sales.controller.js';
import { salesManifest } from './sales.manifest.js';
import { SalesService, type CreateQuoteInput } from './sales.service.js';

/**
 * Quotation and contracts. Depends on CRM (the client, and the project a quote creates or
 * a rate card is applied to) and Documents (the filed PDF, and a contract's signed
 * original) — both through their services, both one-way.
 *
 * Note what is NOT here: Billing. A quote does not know about invoices, and invoicing
 * does not know about quotes. They meet at the project, which is the seam that keeps
 * either module replaceable.
 */
@Module({
  imports: [CrmModule, DocsModule],
  controllers: [SalesController, ContractsController],
  providers: [SalesService, ContractsService],
  exports: [SalesService, ContractsService],
})
export class SalesModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly sales: SalesService,
    private readonly contracts: ContractsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(salesManifest);
    await this.sales.ensureReportingViews();
    await this.contracts.ensureReportingViews();

    this.aiTools.bind('sales_list_quotes', (actor: Actor, input) =>
      this.sales.listQuotes(actor, input as { clientId?: string; status?: string }),
    );
    this.aiTools.bind('sales_draft_quote', (actor: Actor, input) =>
      this.sales.createDraft(actor, input as CreateQuoteInput, { aiInitiated: true }),
    );
    this.aiTools.bind('sales_list_contracts', (actor: Actor, input) =>
      this.contracts.list(actor, input as { clientId?: string; type?: string }),
    );
    this.aiTools.bind('sales_draft_contract_terms', (actor: Actor, input) =>
      this.contracts.create(actor, input as CreateContractInput),
    );
    // sales_send_quote is deliberately NOT bound: the assistant never sends a
    // client-facing commercial document, the same position taken for invoices.
  }
}
