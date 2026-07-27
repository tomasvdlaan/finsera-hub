import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { CrmModule } from '../crm/crm.module.js';
import { DocsController } from './docs.controller.js';
import { docsManifest } from './docs.manifest.js';
import { DocsService } from './docs.service.js';

/**
 * Document Management. Depends on CRM (a document is filed under a client or project);
 * the dependency runs one way, as Time → CRM does.
 */
@Module({
  imports: [CrmModule],
  controllers: [DocsController],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly docs: DocsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(docsManifest);
    await this.docs.ensureReportingViews();
    await this.docs.ensureSearchIndexes();

    this.aiTools.bind('docs_search', (actor: Actor, input) =>
      this.docs.searchTool(actor, input as { query: string; limit?: number }),
    );
    this.aiTools.bind('docs_list', (actor: Actor, input) =>
      this.docs.listTool(actor, input as { clientId?: string; projectId?: string }),
    );
    this.aiTools.bind('docs_ask', (actor: Actor, input) => {
      const { documentId, question } = input as { documentId: string; question: string };
      return this.docs.askDocument(actor, documentId, question);
    });
  }
}
