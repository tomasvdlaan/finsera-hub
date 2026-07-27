import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../db/db.module.js';
import { events } from '../db/core.schema.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';

export interface PublishInput {
  name: string; //        'demo_item.created'
  entityType: string;
  entityId: string;
  actorId?: string | null;
  /** IDs and scalars ONLY — subscribers fetch what they need via the owning module's API. */
  payload?: Record<string, unknown>;
}

/**
 * The outbox half of the event bus (Master §9).
 *
 * Publishing writes a row inside the CALLER'S transaction, so an event can never
 * describe a change that rolled back. Delivery is a separate concern (EventDispatcher),
 * which is what makes the bus reliable without a broker.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private onPublished?: () => void;

  constructor(private readonly manifests: ManifestRegistry) {}

  /** The dispatcher registers here to be nudged after commit; polling is the fallback. */
  registerListener(fn: () => void): void {
    this.onPublished = fn;
  }

  async publish(tx: Tx, input: PublishInput): Promise<string> {
    // An event nobody declared is a typo waiting to be debugged at 2am.
    const declared = this.manifests.all().some((m) => m.publishes.some((p) => p.name === input.name));
    if (!declared) {
      throw new Error(`Undeclared event '${input.name}' — add it to the module's manifest.`);
    }

    const id = uuidv7();
    await tx.insert(events).values({
      id,
      eventName: input.name,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
    });

    // Fire-and-forget nudge; safe if it arrives before commit because the dispatcher
    // reads committed rows only, and the poll cycle catches anything it misses.
    queueMicrotask(() => this.onPublished?.());
    return id;
  }
}
