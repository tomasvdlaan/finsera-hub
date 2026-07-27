import { Injectable } from '@nestjs/common';

export interface EventContext {
  eventId: string;
  eventName: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  payload: Record<string, unknown>;
}

export type EventHandler = (ctx: EventContext) => Promise<void> | void;

/**
 * Maps '<module>.<handlerName>' — the key a manifest declares under `subscribes` — to
 * the actual function. Modules bind their handlers at bootstrap; the dispatcher never
 * imports a module, it only looks up strings the manifests told it about.
 */
@Injectable()
export class EventHandlerRegistry {
  private readonly handlers = new Map<string, EventHandler>();

  bind(module: string, handlerName: string, fn: EventHandler): void {
    const key = `${module}.${handlerName}`;
    if (this.handlers.has(key)) {
      throw new Error(`Handler '${key}' is already bound.`);
    }
    this.handlers.set(key, fn);
  }

  get(module: string, handlerName: string): EventHandler | undefined {
    return this.handlers.get(`${module}.${handlerName}`);
  }

  has(key: string): boolean {
    return this.handlers.has(key);
  }
}
