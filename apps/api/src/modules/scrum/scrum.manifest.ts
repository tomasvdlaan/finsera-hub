import { defineManifest } from '@platform/contracts';
import { z } from 'zod';
import { PRIORITIES } from './scrum.schema.js';

export const scrumManifest = defineManifest({
  name: 'scrum',
  version: '0.1.0',

  entities: [
    { type: 'task', displayTemplate: '{title}', urlPattern: '/scrum/tasks/:id', readPermission: 'scrum.tasks.read' },
    { type: 'sprint', displayTemplate: '{name}', urlPattern: '/scrum/sprints/:id', readPermission: 'scrum.tasks.read' },
  ],

  structuralRefs: [
    { from: 'task', toType: 'project', required: true },
    { from: 'task', toType: 'task', required: false }, // an epic is a parent task
  ],

  publishes: [
    { name: 'task.created', description: 'A task was created.' },
    { name: 'task.moved', description: 'A task changed column.' },
    { name: 'task.completed', description: 'A task reached a done column.' },
    { name: 'task.assigned', description: 'A task was assigned to someone.' },
    { name: 'task.blocked', description: 'A task cannot move, and said why.' },
    { name: 'task.unblocked', description: 'A task stopped being blocked.' },
    { name: 'sprint.started', description: 'A sprint became active.' },
    {
      name: 'sprint.completed',
      description: 'A sprint was closed; unfinished cards returned to the backlog.',
    },
  ],

  // Phase 6c's Meeting Agent will publish meeting.action_points_suggested, and this
  // module will subscribe to offer them as draft tasks. The seam is deliberate.
  subscribes: [],

  permissions: [
    { capability: 'scrum.tasks.read', description: 'View boards and tasks.' },
    { capability: 'scrum.tasks.write', description: 'Create, edit and move tasks.' },
    { capability: 'scrum.board.manage', description: 'Configure columns and sprints.' },
  ],

  navigation: [{ label: 'Board', path: '/scrum', icon: 'columns', section: 'work', order: 2 }],

  widgets: [{ slot: 'entity-page', component: 'scrum:open-tasks' }],

  chatWidgets: [{ entityType: 'task', component: 'scrum:task-card' }],

  reportingViews: [
    {
      view: 'scrum.v_tasks',
      description:
        'Tasks with status, estimate in minutes, completion, and whether and for how long ' +
        'they are blocked.',
    },
    {
      view: 'scrum.v_task_flow',
      description:
        'One row per live card: how long it took from start to done, how long from creation ' +
        'to done, how long it has been in flight if it still is, how long it has spent ' +
        'waiting on a client, and how many times it came back after being finished.',
    },
    {
      view: 'scrum.v_column_flow',
      description:
        "Each board column's role — queue, active, waiting or done — so a query can tell " +
        'work in progress from a backlog without knowing what anyone named their columns.',
    },
    {
      view: 'scrum.v_sprints',
      description:
        'Sprints with their goal, dates, state, and cards and estimated minutes done vs total.',
    },
  ],

  portalExposure: [], // Phase 7 exposes task status in reduced form

  aiTools: [
    {
      name: 'scrum_list_tasks',
      description: 'List tasks, optionally for one project or column. Use for "what is open on X?".',
      inputSchema: z.object({
        projectId: z.string().uuid().optional(),
        status: z.string().optional(),
      }),
      outputSchema: z.object({}),
      permission: 'scrum.tasks.read',
      riskClass: 'read',
      handler: 'listTasksTool',
    },
    {
      name: 'scrum_task_detail',
      description: 'One task with its subtasks and the hours logged against it.',
      inputSchema: z.object({ taskId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'scrum.tasks.read',
      riskClass: 'read',
      handler: 'getTask',
    },
    {
      name: 'scrum_create_task',
      description:
        'Create a task on a project board. Estimates are in minutes (90 = one and a half hours).',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.string().optional(),
        estimateMinutes: z.number().int().min(1).max(100_000).optional(),
        priority: z.enum(PRIORITIES).optional(),
        dueOn: z.string().optional(),
        parentId: z.string().uuid().optional(),
      }),
      outputSchema: z.object({ id: z.string(), title: z.string() }),
      permission: 'scrum.tasks.write',
      riskClass: 'write:draft',
      handler: 'createTaskTool',
    },
    {
      name: 'scrum_move_task',
      description: 'Move a task to another column, e.g. "move the dataset task to review".',
      inputSchema: z.object({ taskId: z.string().uuid(), status: z.string() }),
      outputSchema: z.object({}),
      permission: 'scrum.tasks.write',
      riskClass: 'write:draft',
      handler: 'moveTaskTool',
    },
  ],
});
