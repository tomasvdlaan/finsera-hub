import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

const period = z.object({
  from: z.string().describe('Inclusive start, YYYY-MM-DD'),
  to: z.string().describe('EXCLUSIVE end, YYYY-MM-DD'),
});

/**
 * Reporting is a pure consumer: no entities, no events, no schema. It reads the views
 * every other module publishes.
 *
 * Note the AI tools: each metric is its own tool with typed parameters, rather than one
 * tool that accepts a query. The model chooses a metric and a period; it never composes
 * SQL. Every number it can state is one that was written and tested by hand.
 */
export const reportingManifest = defineManifest({
  name: 'reporting',
  version: '0.1.0',

  entities: [],
  structuralRefs: [],
  publishes: [],
  subscribes: [],

  permissions: [{ capability: 'reporting.read', description: 'View business reporting.' }],

  navigation: [{ label: 'Overview', path: '/reporting', icon: 'bar-chart', section: 'money', order: 4, hidden: true }],
  widgets: [
    { slot: 'dashboard', component: 'reporting:owed' },
    { slot: 'dashboard', component: 'reporting:unbilled' },
    { slot: 'dashboard', component: 'reporting:ar-aging' },
    { slot: 'dashboard', component: 'reporting:who-pays-late' },
    { slot: 'dashboard', component: 'reporting:budget-burn' },
    { slot: 'dashboard', component: 'reporting:pipeline-funnel' },
    { slot: 'dashboard', component: 'reporting:client-concentration' },
    { slot: 'dashboard', component: 'reporting:whats-ending' },
  ],
  chatWidgets: [],
  reportingViews: [],
  portalExposure: [],

  aiTools: [
    {
      name: 'reporting_revenue',
      description:
        'Invoiced revenue in a period, by month and by client. Counts issued and paid invoices by issue date, including credit notes as negatives. Amounts are euro cents.',
      inputSchema: period,
      outputSchema: z.object({}),
      permission: 'reporting.read',
      riskClass: 'read',
      handler: 'revenue',
    },
    {
      name: 'reporting_outstanding',
      description: 'What clients currently owe, split into current and overdue. Euro cents.',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      permission: 'reporting.read',
      riskClass: 'read',
      handler: 'outstanding',
    },
    {
      name: 'reporting_unbilled',
      description:
        'Billable work done but not yet invoiced, per project, valued at the project rate. This is an estimate of work in hand, not a receivable.',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      permission: 'reporting.read',
      riskClass: 'read',
      handler: 'unbilled',
    },
    {
      name: 'reporting_utilisation',
      description:
        'Share of logged time that is billable in a period, with invoiced minutes. Returns a null ratio when nothing was logged.',
      inputSchema: period,
      outputSchema: z.object({}),
      permission: 'reporting.read',
      riskClass: 'read',
      handler: 'utilisation',
    },
    {
      name: 'reporting_project_profitability',
      description:
        'Hours and earned value per project against budget, for projects with logged time.',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      permission: 'reporting.read',
      riskClass: 'read',
      handler: 'projectProfitability',
    },
    {
      name: 'reporting_pipeline',
      description:
        'Quotes by status with outstanding and won value, and the conversion rate. The rate is null until something has been decided.',
      inputSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
      outputSchema: z.object({}),
      permission: 'reporting.read',
      riskClass: 'read',
      handler: 'pipeline',
    },
    {
      name: 'reporting_renewals',
      description: 'Signed contracts ending within N days, with their notice deadlines.',
      inputSchema: z.object({ withinDays: z.number().int().optional() }),
      outputSchema: z.object({}),
      permission: 'reporting.read',
      riskClass: 'read',
      handler: 'renewals',
    },
  ],
});
