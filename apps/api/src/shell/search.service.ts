import { Injectable } from '@nestjs/common';
import type { Actor, EntityRef } from '@platform/contracts';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { PermissionService } from '../core/permissions/permission.service.js';
import { RegistryService } from '../core/registry/registry.service.js';

/**
 * Finding anything, by name, from anywhere.
 *
 * This is a shell concern rather than a module one, and deliberately: no module can answer
 * "what in the platform is called Vandenberg" without importing every other module, which the
 * architecture forbids and should. The shell is the one layer allowed to compose what modules
 * declared, so it is the only place this can live.
 *
 * It is cheap because registration is an invariant. Every entity — client, project, note,
 * document, invoice, quote, contract, task, sprint — is in one table with a display name and
 * a URL, written in the same transaction as the module row. Nothing here knows what any of
 * those things are.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly registry: RegistryService,
    private readonly manifests: ManifestRegistry,
    private readonly permissions: PermissionService,
  ) {}

  async find(actor: Actor, query: string, limit = 20): Promise<EntityRef[]> {
    return this.registry.search(query, await this.visibleTypes(actor), limit);
  }

  /**
   * The entity types this actor may be told exist.
   *
   * Filtering by type rather than by row is the honest limit of this, and it is why the
   * capability is declared on the entity instead of guessed: it answers "may you see things
   * of this kind", not "may you see this one". For everything the platform holds today those
   * are the same question — a member who may read the CRM may read every client in it — but a
   * module that later needs per-row visibility must not be searched through here until this
   * knows how to ask.
   *
   * The alternative, searching everything and trusting the pages to refuse, would leak the
   * one thing a search cannot take back: that a name exists.
   */
  private async visibleTypes(actor: Actor): Promise<string[]> {
    const declared = this.manifests.all().flatMap((m) => m.entities);
    const decided = await Promise.all(
      declared.map(async (e) =>
        (await this.permissions.can(actor, e.readPermission)) ? e.type : null,
      ),
    );
    return decided.filter((t): t is string => t !== null);
  }
}
