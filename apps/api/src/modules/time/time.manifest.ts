import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

/**
 * The Time Registration manifest (Phase 2 brief §6).
 *
 * Note `widgets`: this module contributes the budget-burn indicator to CRM's project
 * page. CRM gains a feature without CRM changing — the manifest mechanism doing exactly
 * what it was designed for.
 */
export const timeManifest = defineManifest({
  name: 'time',
  version: '0.1.0',

  entities: [{ type: 'time_entry', displayTemplate: '{description}', urlPattern: '/time', readPermission: 'time.entries.read_all' }],

  structuralRefs: [{ from: 'time_entry', toType: 'project', required: true }],

  publishes: [
    { name: 'time_entry.created', description: 'Hours were logged, or a timer was started.' },
  ],

  subscribes: [],

  permissions: [
    { capability: 'time.entries.write_own', description: 'Log and edit your own hours.' },
    { capability: 'time.entries.read_all', description: "See everyone's hours." },
    { capability: 'time.entries.manage', description: "Manage another person's hours." },
  ],

  navigation: [{ label: 'Timesheet', path: '/time', icon: 'clock', section: 'time', order: 1 }],

  widgets: [
    { slot: 'entity-page', component: 'time:project-burn' },
    { slot: 'dashboard', component: 'time:logged-today' },
    { slot: 'dashboard', component: 'time:fortnight' },
  ],

  reportingViews: [
    {
      view: 'time.v_entries',
      description:
        'Time entries with person, project, the task they were logged against, and billability.',
    },
    { view: 'time.v_weekly_totals', description: 'Minutes per person per week, billable split.' },
  ],

  portalExposure: [], // hours are internal-only, and stay that way in Phase 7

  aiTools: [
    {
      name: 'time_get_week',
      description:
        'Get the hours you logged in a given week. Dates are ISO (YYYY-MM-DD); any date inside the week works.',
      inputSchema: z.object({ weekOf: z.string().optional() }),
      outputSchema: z.object({}),
      permission: 'time.entries.write_own',
      riskClass: 'read',
      handler: 'getWeek',
    },
    {
      name: 'time_project_hours',
      description: 'Total hours logged against a project, and how that compares to its budget.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'time.entries.read_all',
      riskClass: 'read',
      handler: 'projectBurn',
    },
    {
      name: 'time_get_day',
      description: 'List the time entries for one day, with start/end times and notes.',
      inputSchema: z.object({ date: z.string().optional() }),
      outputSchema: z.object({}),
      permission: 'time.entries.write_own',
      riskClass: 'read',
      handler: 'getDay',
    },
    {
      name: 'time_log_hours',
      description:
        'Log hours against a project. Give either minutes (90 = one and a half hours) or a start and end time. Omitting the end time starts a running timer.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        workedOn: z.string().optional(), // ISO date; defaults to today
        minutes: z.number().int().min(1).max(1440).optional(),
        startedAt: z.string().optional(), // ISO timestamp
        endedAt: z.string().optional(),
        description: z.string().optional(),
        billable: z.boolean().optional(),
      }),
      outputSchema: z.object({ id: z.string() }),
      permission: 'time.entries.write_own',
      riskClass: 'write:draft',
      handler: 'createEntry',
    },
    {
      name: 'time_stop_timer',
      description: 'Stop the currently running timer and record the elapsed time.',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      permission: 'time.entries.write_own',
      riskClass: 'write:draft',
      handler: 'stopEntry',
    },
  ],
});
