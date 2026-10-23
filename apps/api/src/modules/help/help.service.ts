import { Injectable } from '@nestjs/common';
import type { ModuleManifest } from '@platform/contracts';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { loadGuides, type HelpPage } from './help.content.js';
import { buildReference, moduleLabel } from './help.reference.js';
import { HelpIndex, type SearchHit } from './help.search.js';

export interface HelpNavEntry {
  slug: string;
  title: string;
  summary: string;
  kind: HelpPage['kind'];
}
export interface HelpNavGroup {
  module: string;
  label: string;
  /** The module's overview page, when it has one. */
  overview: HelpNavEntry | null;
  pages: HelpNavEntry[];
}

const entry = (p: HelpPage): HelpNavEntry => ({ slug: p.slug, title: p.title, summary: p.summary, kind: p.kind });

/**
 * Help, assembled once.
 *
 * Built on first use rather than at construction because the manifest registry is only
 * complete after every module has registered, and an index built earlier would miss whichever
 * modules loaded after this one. After that it is read-only, so there is nothing to
 * invalidate: content changes with a deploy, and so do manifests.
 */
@Injectable()
export class HelpService {
  private built: { pages: Map<string, HelpPage>; index: HelpIndex } | null = null;

  constructor(private readonly manifests: ManifestRegistry) {}

  private load() {
    if (!this.built) this.built = assemble(this.manifests.all(), loadGuides());
    return this.built;
  }

  /** The browse tree: the start page, then each module's guides, then the generated reference. */
  nav(): { start: HelpNavEntry | null; groups: HelpNavGroup[]; reference: HelpNavEntry[] } {
    const { pages } = this.load();
    const all = [...pages.values()];
    const byModule = new Map<string, HelpPage[]>();
    for (const p of all) {
      if (p.kind !== 'guide' || p.slug === 'index') continue;
      byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
    }
    const groups: HelpNavGroup[] = [...byModule.entries()]
      .map(([module, ps]) => {
        const overview = ps.find((p) => p.slug === `${module}/index`) ?? null;
        return {
          module,
          label: module === 'shell' ? 'Using the platform' : module === 'help' ? 'Help' : moduleLabel(module),
          overview: overview ? entry(overview) : null,
          pages: ps.filter((p) => p !== overview).map(entry),
        };
      })
      // The shell first, because it is where somebody who has never opened the product starts.
      .sort((a, b) => (a.module === 'shell' ? -1 : b.module === 'shell' ? 1 : a.label.localeCompare(b.label)));
    const start = pages.get('index');
    return {
      start: start ? entry(start) : null,
      groups,
      reference: all.filter((p) => p.kind === 'reference').map(entry),
    };
  }

  page(slug: string): HelpPage | null {
    return this.load().pages.get(slug) ?? null;
  }

  /**
   * A page by whatever the caller managed to say: the slug, the slug with a leading slash or
   * `help:` or `.md`, or the page's title.
   *
   * The assistant is the main caller, and a model that has just read "Approve or send back a
   * week" will sooner or later pass that instead of `time/approve-weeks`. Refusing it taught the
   * model that the page does not exist, and it then answered from general knowledge — which is
   * the failure the tools exist to prevent. Being forgiving here costs nothing.
   */
  find(ref: string): HelpPage | null {
    const { pages } = this.load();
    const clean = ref.trim().replace(/^help:/, '').replace(/^\/+/, '').replace(/\.md$/, '');
    const direct = pages.get(clean) ?? pages.get(clean.toLowerCase());
    if (direct) return direct;
    const lower = ref.trim().toLowerCase();
    for (const p of pages.values()) if (p.title.toLowerCase() === lower) return p;
    return null;
  }

  search(query: string, limit = 8): SearchHit[] {
    return this.load().index.search(query, limit);
  }

  /** Every page, for the tests that check coverage. */
  allPages(): HelpPage[] {
    return [...this.load().pages.values()];
  }
}

/** Pure, so the content spec can build the same thing without Nest. */
export function assemble(manifests: ModuleManifest[], guides: HelpPage[]) {
  const pages = new Map<string, HelpPage>();
  for (const p of [...guides, ...buildReference(manifests)]) {
    if (pages.has(p.slug)) throw new Error(`Two help pages share the address '${p.slug}'.`);
    pages.set(p.slug, p);
  }
  return { pages, index: new HelpIndex([...pages.values()]) };
}
