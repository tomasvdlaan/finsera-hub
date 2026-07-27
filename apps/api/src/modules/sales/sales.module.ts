import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { CrmModule } from '../crm/crm.module.js';
import { DocsModule } from '../docs/docs.module.js';
import { SalesController } from './sales.controller.js';
import { salesManifest } from './sales.manifest.js';
import { SalesService, type CreateQuoteInput } from './sales.service.js';

/**
 * Quotation. Depends on CRM (the client and, on acceptance, the project it creates) and
 * Documents (the filed PDF) — both through their services, both one-way.
 *
 * Note what is NOT here: Billing. A quote does not know about invoices, and invoicing
 * does not know about quotes. They meet at the project, which is the seam that keeps
 * either module replaceable.
 */
@Module({
  imports: [CrmModule, DocsModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly sales: SalesService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(salesManifest);
    await this.sales.ensureReportingViews();

    this.aiTools.bind('sales_list_quotes', (actor: Actor, input) =>
      this.sales.listQuotes(actor, input as { clientId?: string; status?: string }),
    );
    this.aiTools.bind('sales_draft_quote', (actor: Actor, input) =>
      this.sales.createDraft(actor, input as CreateQuoteInput, { aiInitiated: true }),
    );
    // sales_send_quote is deliberately NOT bound: the assistant never sends a
    // client-facing commercial document, the same position taken for invoices.
  }
}
