import { Injectable, Logger } from '@nestjs/common';
import {
  moduleManifestSchema,
  type AiToolDeclaration,
  type ModuleManifest,
} from '@platform/contracts';

/**
 * Collects every module's manifest at bootstrap and validates the whole set (spec §5).
 *
 * Startup FAILS LOUDLY on: duplicate entity types, duplicate event names, duplicate AI
 * tool names, or a subscription to an event no module publishes. Catching these at boot
 * is the point — a silent collision would corrupt the registry's one-identity guarantee.
 */
@Injectable()
export class ManifestRegistry {
  private readonly logger = new Logger(ManifestRegistry.name);
  private readonly manifests = new Map<string, ModuleManifest>();
  private sealed = false;

  register(raw: ModuleManifest): void {
    if (this.sealed) {
      throw new Error(`Manifest for '${raw.name}' registered after bootstrap sealed the registry.`);
    }
    const manifest = moduleManifestSchema.parse(raw);
    if (this.manifests.has(manifest.name)) {
      throw new Error(`Duplicate module name '${manifest.name}'.`);
    }
    this.manifests.set(manifest.name, manifest);
    this.logger.log(
      `Registered module '${manifest.name}' v${manifest.version} ` +
        `(${manifest.entities.length} entities, ${manifest.aiTools.length} AI tools)`,
    );
  }

  /** Called once after all modules have registered. Throws on any cross-module collision. */
  seal(): void {
    const problems: string[] = [];
    const entityTypes = new Map<string, string>();
    const eventNames = new Map<string, string>();
    const toolNames = new Map<string, string>();

    for (const m of this.manifests.values()) {
      for (const e of m.entities) {
        const owner = entityTypes.get(e.type);
        if (owner) problems.push(`entity type '${e.type}' claimed by both '${owner}' and '${m.name}'`);
        else entityTypes.set(e.type, m.name);
      }
      for (const p of m.publishes) {
        const owner = eventNames.get(p.name);
        if (owner) problems.push(`event '${p.name}' published by both '${owner}' and '${m.name}'`);
        else eventNames.set(p.name, m.name);
      }
      for (const t of m.aiTools) {
        const owner = toolNames.get(t.name);
        if (owner) problems.push(`AI tool '${t.name}' declared by both '${owner}' and '${m.name}'`);
        else toolNames.set(t.name, m.name);
      }
    }

    for (const m of this.manifests.values()) {
      for (const s of m.subscribes) {
        if (!eventNames.has(s.event)) {
          problems.push(`'${m.name}' subscribes to '${s.event}', which no module publishes`);
        }
      }
      for (const r of m.structuralRefs) {
        if (!entityTypes.has(r.toType)) {
          problems.push(`'${m.name}' references unknown entity type '${r.toType}'`);
        }
      }
    }

    if (problems.length > 0) {
      throw new Error(`Manifest validation failed:\n  - ${problems.join('\n  - ')}`);
    }

    this.sealed = true;
    this.logger.log(
      `Manifests sealed: ${this.manifests.size} modules, ${entityTypes.size} entity types, ` +
        `${eventNames.size} events, ${toolNames.size} AI tools.`,
    );
  }

  all(): ModuleManifest[] {
    return [...this.manifests.values()];
  }

  /**
   * Whether some module declares this reference as structurally required.
   *
   * Manifests already say `{ from: 'task', toType: 'project', required: true }`, and that
   * declaration was enforced on nothing: a required link could be deleted from the UI, which
   * silently dropped the task out of its project's and its client's timelines with no way to
   * put it back — the link picker does not offer structural kinds.
   */
  isRequiredRef(fromType: string, toType: string): boolean {
    return this.all().some((m) =>
      m.structuralRefs.some((r) => r.required && r.from === fromType && r.toType === toType),
    );
  }

  ownerOfEntityType(type: string): string | undefined {
    return this.all().find((m) => m.entities.some((e) => e.type === type))?.name;
  }

  /** Subscribers of an event, as '<module>.<handler>' keys — used by the dispatcher. */
  subscribersOf(eventName: string): Array<{ module: string; handler: string }> {
    return this.all().flatMap((m) =>
      m.subscribes.filter((s) => s.event === eventName).map((s) => ({ module: m.name, handler: s.handler })),
    );
  }

  /** Every declared AI tool, with its owning module. The orchestrator (Phase 2) filters
   *  these per conversation by the USER's permissions — never widened. */
  aiTools(): Array<AiToolDeclaration & { module: string }> {
    return this.all().flatMap((m) => m.aiTools.map((t) => ({ ...t, module: m.name })));
  }
}
