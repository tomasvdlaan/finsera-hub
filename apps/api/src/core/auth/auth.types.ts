import type { Actor } from '@platform/contracts';

/**
 * Every request carries an Actor. There is no broad service account for user-facing
 * paths — the AI orchestrator (Phase 2) will run tool calls under this same object,
 * which is what makes "the assistant is the user" true by construction (AI plan §6).
 */
declare module 'express' {
  interface Request {
    actor?: Actor;
  }
}

export type { Actor };
