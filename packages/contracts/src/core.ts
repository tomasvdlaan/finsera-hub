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
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
