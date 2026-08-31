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

  /*
   * Three of these four are admin-only, and that is the whole boundary between a colleague and
   * the person who runs the business.
   *
   * The policy in `permission.service.ts` is members-hold-everything-not-marked, which was the
   * right default while the only capabilities were about the work itself. These three are not:
   * they are about other people. Left open, a member could read a colleague's hours, edit them,
   * and approve their own week — the last of which is not a permission model at all, it is an
   * honour system with a database behind it.
   *
   * `write_own` stays open, because logging your own hours is the job.
   *
   * The cost is real and worth stating rather than discovering: with one admin away, nobody can
   * approve a week. At two-to-four people that is the correct trade. At ten it stops being one,
   * and the answer then is a role model rather than a wider default.
   */
  permissions: [
    { capability: 'time.entries.write_own', description: 'Log and edit your own hours.' },
    { capability: 'time.entries.read_all', description: "See everyone's hours.", adminOnly: true },
    {
      capability: 'time.entries.manage',
      description: "Manage another person's hours.",
      adminOnly: true,
    },
    /*
     * Separate from `manage` on purpose.
     *
     * Editing somebody's hours and agreeing that they may be invoiced are different powers, and
     * the second is the one that puts a number in front of a client. A bookkeeper who fixes
     * typos should not thereby be able to sign work off.
     */
    {
      capability: 'time.approve',
      description: "Approve or send back a person's week.",
      adminOnly: true,
    },
    /*
     * Declared here rather than reusing `core.people.manage`, which governs the same fact.
     *
     * A module enforces the capabilities it declares — reaching for another module's is exactly
     * the coupling the manifest contract exists to prevent, and it breaks the moment somebody
     * builds a registry without the shell in it. Both are admin-only, so today they grant the
     * same set of people; if they ever diverge, the honest reading is that seeing what an hour
     * cost and editing what a person costs are genuinely different powers.
     */
    {
      capability: 'time.costs.read',
      description: 'See what logged hours cost, and the margin on them.',
      adminOnly: true,
    },
  ],

  navigation: [{ label: 'Timesheet', path: '/time', icon: 'clock', section: 'time', order: 1 }],

  widgets: [
    { slot: 'entity-page', component: 'time:project-burn' },
    { slot: 'dashboard', component: 'time:logged-today' },
    { slot: 'dashboard', component: 'time:fortnight' },
    { slot: 'dashboard', component: 'time:where-it-went' },
    { slot: 'dashboard', component: 'time:calendar-heat' },
    { slot: 'dashboard', component: 'time:untracked' },
    { slot: 'dashboard', component: 'time:person-load' },
    { slot: 'dashboard', component: 'time:timer' },
    { slot: 'dashboard', component: 'time:timesheet-health' },
    { slot: 'dashboard', component: 'time:approvals' },
    { slot: 'dashboard', component: 'time:my-week' },
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
      description:
        'Stop the currently running timer and record the elapsed time. A clock left running ' +
        'for more than a day cannot be saved as elapsed; pass the minutes actually worked, ' +
        'asking first rather than guessing.',
      inputSchema: z.object({ minutes: z.number().int().min(1).max(1440).optional() }),
      outputSchema: z.object({}),
      permission: 'time.entries.write_own',
      riskClass: 'write:draft',
      handler: 'stopEntry',
    },
  ],
});
