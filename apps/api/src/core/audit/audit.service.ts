import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../db/db.module.js';
import { auditLog } from '../db/core.schema.js';

export interface AuditInput {
  actorId?: string | null; // null = system (e.g. the event dispatcher)
  action: string; //         'demo_item.create', 'link.create', …
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
  /** True when an AI tool call produced this mutation (AI plan §2). */
  aiInitiated?: boolean;
  conversationId?: string;
}

/**
 * Audit log — every mutation on core entities is recorded (Master §30).
 *
 * Takes a Tx on purpose: the audit entry commits with the change it describes, so the
 * log cannot drift from reality. "Who created this quote?" must always have an answer,
 * including when the answer is "the assistant, confirmed by Tomas".
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, input: AuditInput): Promise<void> {
    await tx.insert(auditLog).values({
      id: uuidv7(),
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      detail: input.detail ?? {},
      aiInitiated: input.aiInitiated ?? false,
      conversationId: input.conversationId ?? null,
    });
  }
}
