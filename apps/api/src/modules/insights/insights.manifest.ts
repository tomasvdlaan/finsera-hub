import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

/**
 * Insights observes every module and belongs to none.
 *
 * It declares no structural refs because an insight can be about anything with a registry
 * id, and it publishes no domain events: "a contract is expiring" is not something that
 * happened to a contract, it is a fact about today crossing a threshold. That distinction
 * is why `contract.expiring` was deferred out of Phase 5b rather than published there —
 * modelling it as an insight is the honest shape.
 */
export const insightsManifest = defineManifest({
  name: 'insights',
  version: '0.1.0',

  entities: [{ type: 'insight', displayTemplate: '{title}', urlPattern: '/insights', readPermission: 'insights.read' }],
  structuralRefs: [],
  publishes: [],
  subscribes: [],

  permissions: [
    { capability: 'insights.read', description: 'See what the platform has noticed.' },
    { capability: 'insights.write', description: 'Dismiss and restore insights.' },
  ],

  // Beside Today rather than in More. It is the page that says what needs attention, and
  // Today shows a digest of exactly these rows — filing it under 'More' buried it.
  navigation: [{ label: 'Inbox', path: '/insights', icon: 'bell', section: 'today', order: 2 }],
  widgets: [],
  chatWidgets: [],
  reportingViews: [],
  portalExposure: [],

  aiTools: [
    {
      name: 'insights_list',
      description:
        'Things the platform has noticed and nobody has dealt with: overdue invoices, unanswered quotes, contract notice deadlines, budgets nearly spent, work left uninvoiced, cards that have been in flight too long, blocked cards, work sitting with a client, tasks past their due date, and sprints ending with a lot still open. Ordered most urgent first.',
      inputSchema: z.object({
        status: z.enum(['open', 'dismissed', 'resolved']).optional(),
        rule: z.string().optional(),
      }),
      outputSchema: z.object({}),
      permission: 'insights.read',
      riskClass: 'read',
      handler: 'list',
    },
  ],
});
