import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

/**
 * The core's own manifest.
 *
 * Every other manifest belongs to a module and declares that module's entities, events and
 * tools. This one declares nothing of its own — the core owns no entities — and exists for a
 * single reason: the AI tool registry builds its tool set from `manifests.aiTools()`, so a
 * capability that belongs to no module has nowhere to be declared and therefore cannot be
 * offered to the assistant.
 *
 * The activity log is exactly that shape. `core.events` is written by seven modules and
 * belongs to none of them, and reading it back is a question about the platform rather than
 * about scrum or billing. Filing these tools under a module would have meant choosing one
 * arbitrarily and making every other module's events look like an afterthought.
 */
export const coreManifest = defineManifest({
  name: 'core',
  version: '1.0.0',

  permissions: [
    {
      capability: 'core.activity.read',
      description: 'Read the activity log — what changed, when, and who changed it.',
      // Not admin-only. Every row is filtered by what the reader may already open, so the
      // feed can never widen access — it only reorders what is reachable by time.
      adminOnly: false,
    },
    {
      capability: 'core.people.manage',
      description: "Change a colleague's role, status, and what the business records about them.",
      /*
       * Admin only, and this is the clearest case for it in the product.
       *
       * The capability grants the power to make somebody else an administrator, which is the
       * one permission that can be used to acquire every other permission. A member who could
       * use it would not be a member.
       */
      adminOnly: true,
    },
  ],

  aiTools: [
    {
      name: 'activity_recent',
      /*
       * Written to win against thirty-nine other tools.
       *
       * Every other tool reports current state, and several of them can be made to *look*
       * like they answer a question about the past — list the tasks, read each one, infer a
       * story. That answer is plausible and wrong, so the description has to say not just
       * what this does but what it replaces.
       */
      description:
        'THE history of the platform: every change to every record, newest first, with who ' +
        'made it and what it said — tasks moved, invoices sent, notes written, hours logged, ' +
        'sprints closed. This is the ONLY tool that can answer what *happened*; every other ' +
        'tool reports what things are now. Prefer it, and call it FIRST, for any question ' +
        'about a period of time or a change: "what happened this week?", "what did I do ' +
        'yesterday?", "what changed while I was away?", "has anything moved on the CRM ' +
        'side?", "what did Galang do?". Do not reconstruct a history by listing records and ' +
        'reading their current state — that gives an answer that looks right and is not. ' +
        'Narrow with `since` rather than asking for a large limit.',
      inputSchema: z.object({
        since: z
          .string()
          .optional()
          .describe('ISO instant. Everything at or after it, e.g. 2026-07-24T00:00:00Z'),
        until: z.string().optional().describe('ISO instant. Everything at or before it.'),
        entityType: z
          .string()
          .optional()
          .describe(
            'Narrow to one kind of record: task, sprint, note, client, project, invoice, ' +
              'quote, contract, document, entry.',
          ),
        actorId: z.string().uuid().optional().describe('Only what this person did.'),
        eventName: z
          .string()
          .optional()
          .describe('An exact event name, e.g. task.completed or invoice.sent.'),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      outputSchema: z.object({}),
      permission: 'core.activity.read',
      riskClass: 'read',
      handler: 'recentActivity',
    },
    {
      name: 'activity_for',
      description:
        'Everything that has happened to one record and to anything linked to it, newest ' +
        'first. Use for "what is the story on this invoice?" or "has anyone touched this ' +
        'task?" once you already have its id.',
      inputSchema: z.object({
        entityId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      outputSchema: z.object({}),
      permission: 'core.activity.read',
      riskClass: 'read',
      handler: 'activityFor',
    },
  ],
});
