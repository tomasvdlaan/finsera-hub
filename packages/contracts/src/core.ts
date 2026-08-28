import { z } from 'zod';

/** Shared core types used by both api and web. */

/** The identity every request carries. There is no broad service actor for user paths. */
export interface Actor {
  userId: string;
  role: 'admin' | 'member';
}

/** What the registry exposes about any entity — enough to render a link, nothing more. */
export const entityRefSchema = z.object({
  id: z.string().uuid(),
  entityType: z.string(),
  displayName: z.string(),
  urlPath: z.string(),
  deleted: z.boolean(),
});
export type EntityRef = z.infer<typeof entityRefSchema>;

export const linkSchema = z.object({
  id: z.string().uuid(),
  from: entityRefSchema,
  to: entityRefSchema,
  kind: z.string().nullable(),
  createdAt: z.string(),
  /**
   * A reference some manifest declares structurally required, which cannot be removed.
   *
   * Reported by the server because the browser cannot know it: which references are required
   * lives in the manifests. Optional in the schema so an older client keeps parsing.
   */
  required: z.boolean().optional(),
});
export type Link = z.infer<typeof linkSchema>;

export const createLinkSchema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  kind: z.string().optional(),
});
export type CreateLinkInput = z.infer<typeof createLinkSchema>;

/** One row of the core-assembled activity timeline (Master §13). */
export const timelineEntrySchema = z.object({
  eventId: z.string().uuid(),
  eventName: z.string(),
  subject: entityRefSchema,
  actor: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  createdAt: z.string(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const currentUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'member']),
  /**
   * Every capability this person actually holds, resolved server-side from the manifests.
   *
   * The frontend had no way to ask this, so `libraryFor` — which takes a `can` predicate for
   * exactly this purpose — was called with `() => true` at both of its call sites and the
   * `permission` field on every widget was inert. Seven of them named `time.read`, a capability
   * that is declared in no manifest at all, and nothing noticed because nothing was checking.
   *
   * Sent as a list rather than as a rule the client re-derives: the policy lives in
   * `permission.service.ts`, and a second implementation of it in the browser is a second
   * implementation to disagree with the first. The browser only ever consults this list, and
   * it is a courtesy — the server still refuses on every call.
   */
  capabilities: z.array(z.string()),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
