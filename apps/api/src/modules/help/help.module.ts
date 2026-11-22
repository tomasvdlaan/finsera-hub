import { Module, type OnModuleInit } from '@nestjs/common';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { HelpController } from './help.controller.js';
import { helpManifest } from './help.manifest.js';
import { HelpService } from './help.service.js';

/**
 * Help imports no module. It reads the manifest registry, which is what every module has
 * already told the platform about itself — the one place a "what can this system do" page can
 * be generated from without the page knowing any module exists.
 */
@Module({
  controllers: [HelpController],
  providers: [HelpService],
  exports: [HelpService],
})
export class HelpModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly help: HelpService,
  ) {}

  onModuleInit(): void {
    this.manifests.register(helpManifest);

    const body = (page: { body: string }) =>
      // Pages run to a few thousand characters; capped so one very long page cannot crowd out
      // the rest of the conversation. Nothing written so far comes near it.
      page.body.length > 12_000 ? `${page.body.slice(0, 12_000)}\n\n[page continues]` : page.body;

    const read = (page: NonNullable<ReturnType<HelpService['find']>>) => ({
      slug: page.slug,
      title: page.title,
      // Where the page's claims were last checked. Worth passing on if it is old.
      lastChecked: page.updated ?? 'generated from the system, always current',
      requires: page.capability,
      content: body(page),
    });

    this.aiTools.bind('help_search', async (_actor, input) => {
      const { query, limit } = input as { query: string; limit?: number };
      const hits = this.help.search(query, limit ?? 6);
      // The best page comes back in full. Asking the model to make a second call with the right
      // slug was the weak point: a wrong slug read as "no such page", and the model then
      // answered from general knowledge instead.
      const best = hits[0] ? this.help.page(hits[0].slug) : null;
      return {
        hits: hits.map((h) => ({ slug: h.slug, page: h.title, section: h.heading, excerpt: h.snippet })),
        bestPage: best ? read(best) : undefined,
        note:
          hits.length === 0
            ? 'Nothing matched. Try different words, or say there is no help page on it.'
            : 'bestPage is the full text of the top match. Answer from it if it covers the question; otherwise help_read another slug from hits.',
      };
    });

    this.aiTools.bind('help_read', async (_actor, input) => {
      const { slug } = input as { slug: string };
      const page = this.help.find(slug);
      if (page) return read(page);
      return {
        error: `No help page '${slug}'.`,
        didYouMean: this.help.search(slug, 3).map((h) => ({ slug: h.slug, page: h.title })),
      };
    });
  }
}
