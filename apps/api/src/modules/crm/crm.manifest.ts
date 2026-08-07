import { defineManifest } from '@platform/contracts';
import { z } from 'zod';
import { BILLING_MODELS, CLIENT_STATUSES, RETAINER_PERIODS } from './crm.schema.js';

/**
 * The CRM manifest (Phase 1 brief §4) — written as the module is built, never after.
 *
 * The AI tools are declared now even though the assistant ships in Phase 2. That is the
 * whole point of the mechanism: no retrofit when the orchestrator arrives.
 */
export const crmManifest = defineManifest({
  name: 'crm',
  version: '0.1.0',

  entities: [
    { type: 'client', displayTemplate: '{name}', urlPattern: '/crm/clients/:id', readPermission: 'crm.clients.read' },
    { type: 'contact', displayTemplate: '{name}', urlPattern: '/crm/clients/:id', readPermission: 'crm.clients.read' },
    { type: 'project', displayTemplate: '{name}', urlPattern: '/crm/projects/:id', readPermission: 'crm.projects.read' },
  ],

  structuralRefs: [
    { from: 'contact', toType: 'client', required: true },
    { from: 'project', toType: 'client', required: true },
  ],

  publishes: [
    { name: 'client.created', description: 'A client (or prospect) was created.' },
    { name: 'client.status_changed', description: 'A client moved through the pipeline.' },
    { name: 'project.created', description: 'A project was created.' },
    { name: 'project.status_changed', description: 'A project changed status.' },
  ],

  subscribes: [],

  permissions: [
    { capability: 'crm.clients.read', description: 'View clients and contacts.' },
    { capability: 'crm.clients.write', description: 'Create and edit clients and contacts.' },
    { capability: 'crm.projects.read', description: 'View projects.' },
    { capability: 'crm.projects.write', description: 'Create and edit projects.' },
  ],

  navigation: [
    { label: 'Clients', path: '/crm/clients', icon: 'users', section: 'clients', order: 1 },
    { label: 'Projects', path: '/crm/projects', icon: 'folder', section: 'clients', order: 2 },
  ],
  widgets: [],

  chatWidgets: [
    { entityType: 'client', component: 'crm:client-card' },
    { entityType: 'project', component: 'crm:project-card' },
  ],

  // Published now so Phase 6a is assembly rather than archaeology (roadmap principle 4).
  reportingViews: [
    { view: 'crm.v_clients', description: 'Clients with status, owner, and project counts.' },
    { view: 'crm.v_projects', description: 'Projects with client, billing model, and budget.' },
  ],

  /**
   * A client may see their own projects, and only the parts that describe the work.
   * Not `default_rate_cents`, not `budget_amount_cents`, not the internal notes — what we
   * charge and what we budgeted is our side of the arrangement, not theirs to watch.
   * Clients themselves are not exposed at all: a portal visitor already knows who they are.
   */
  portalExposure: [
    { entityType: 'project', fields: ['id', 'name', 'status', 'starts_on', 'ends_on'] },
  ],

  aiTools: [
    {
      name: 'crm_search_clients',
      description:
        'Search clients by name or filter by pipeline status. Use to answer questions about which clients exist.',
      inputSchema: z.object({
        query: z.string().optional(),
        status: z.enum(CLIENT_STATUSES).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      outputSchema: z.object({
        clients: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
      }),
      permission: 'crm.clients.read',
      riskClass: 'read',
      handler: 'searchClients',
    },
    {
      name: 'crm_get_client_overview',
      description:
        'Full picture of one client: details, contacts, and projects. Use before a meeting or when asked about a specific client.',
      inputSchema: z.object({ clientId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'crm.clients.read',
      riskClass: 'read',
      handler: 'getClientOverview',
    },
    {
      name: 'crm_list_projects',
      description: 'List projects, optionally for one client or filtered by status.',
      inputSchema: z.object({
        clientId: z.string().uuid().optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      outputSchema: z.object({}),
      permission: 'crm.projects.read',
      riskClass: 'read',
      handler: 'listProjects',
    },
    {
      name: 'crm_create_lead',
      description: 'Create a new prospective client (status "lead") from a conversation.',
      inputSchema: z.object({
        name: z.string().min(1),
        website: z.string().optional(),
        notes: z.string().optional(),
      }),
      outputSchema: z.object({ id: z.string(), name: z.string() }),
      permission: 'crm.clients.write',
      riskClass: 'write:draft',
      handler: 'createLead',
    },
    {
      name: 'crm_create_project',
      description:
        'Create a project for a client. Amounts are in whole euro cents (e.g. 150000 = €1500.00).',
      inputSchema: z.object({
        clientId: z.string().uuid(),
        name: z.string().min(1),
        billingModel: z.enum(BILLING_MODELS),
        defaultRateCents: z.number().int().min(0).optional(),
        budgetAmountCents: z.number().int().min(0).optional(),
        budgetHours: z.number().min(0).optional(),
        retainerAmountCents: z.number().int().min(0).optional(),
        retainerPeriod: z.enum(RETAINER_PERIODS).optional(),
      }),
      outputSchema: z.object({ id: z.string(), name: z.string() }),
      permission: 'crm.projects.write',
      riskClass: 'write:draft',
      handler: 'createProject',
    },
  ],
});
