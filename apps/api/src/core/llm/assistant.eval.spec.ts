import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { EventBus } from '../events/event-bus.service.js';
import { LinkService } from '../links/link.service.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { crmManifest } from '../../modules/crm/crm.manifest.js';
import { CrmService } from '../../modules/crm/crm.service.js';
import { timeManifest } from '../../modules/time/time.manifest.js';
import { TimeService } from '../../modules/time/time.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { LlmService } from './llm.service.js';
import { OrchestratorService } from './orchestrator.service.js';
import { AiToolRegistry } from './tool-registry.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * The assistant eval set (AI plan §6: "evaluation before expansion").
 *
 * These call a REAL model, so they are skipped without credentials and CI stays free.
 * They are not unit tests — they assert behaviour a model can get wrong: picking the
 * right tool, chaining two of them, and declining to invent data. Any new tool should
 * arrive with a case here before its risk class is ever promoted.
 */
describe.skipIf(!LlmService.hasCredentials())('assistant evals [live]', () => {
  let orchestrator: OrchestratorService;

  const build = () => {
    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.register(timeManifest);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit);
    const bus = new EventBus(manifests);
    const crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    const tools = new AiToolRegistry(manifests, permissions);

    tools.bind('crm_search_clients', (a: Actor, i) => crm.searchClients(a, i as never));
    tools.bind('crm_get_client_overview', (a: Actor, i) =>
      crm.getClientOverview(a, (i as { clientId: string }).clientId),
    );
    tools.bind('crm_list_projects', (a: Actor, i) => crm.listProjects(a, i as never));
    tools.bind('crm_create_lead', (a: Actor, i) => crm.createLead(a, i as never));
    tools.bind('crm_create_project', (a: Actor, i) => crm.createProjectViaAi(a, i as never));
    tools.bind('time_get_week', (a: Actor, i) => time.getWeek(a, i as never));
    tools.bind('time_get_day', (a: Actor, i) => time.getDay(a, i as never));
    tools.bind('time_project_hours', (a: Actor, i) =>
      time.projectBurn(a, (i as { projectId: string }).projectId),
    );
    tools.bind('time_unsubmitted_weeks', (a: Actor) => time.unsubmittedWeeks(a));
    tools.bind('time_log_hours', (a: Actor, i) => time.createEntry(a, i as never, { aiInitiated: true }));
    tools.bind('time_stop_timer', (a: Actor) => time.stopEntry(a));

    return {
      orchestrator: new OrchestratorService(testDb, new LlmService(), tools, registry, permissions),
      crm,
      time,
    };
  };

  beforeAll(() => {
    // A slow model call should fail loudly rather than hang the suite.
    expect(LlmService.hasCredentials()).toBe(true);
  });

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`TRUNCATE time.entries CASCADE`);
    await testDb.execute(sql`TRUNCATE crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const built = build();
    orchestrator = built.orchestrator;

    const client = await built.crm.createClient(actor, { name: 'Chocolaterie', status: 'active' });
    const project = await built.crm.createProject(actor, {
      clientId: client.id,
      name: 'KPI dashboard',
      billingModel: 'time_and_materials',
      defaultRateCents: 10_000, // €100/hr
    });
    await built.time.createEntry(actor, {
      projectId: project.id,
      workedOn: '2026-07-27',
      minutes: 300, // 5h
    });
  });

  it('answers from the CRM rather than guessing', { timeout: 60_000 }, async () => {
    const res = await orchestrator.ask(actor, { message: 'Which clients do we have?' });

    expect(res.answer.toLowerCase()).toContain('chocolaterie');
    expect(res.toolCalls.map((t) => t.toolName)).toContain('crm_search_clients');
  });

  it('chains two modules to answer one question', { timeout: 60_000 }, async () => {
    // Requires finding the project (CRM) and then its hours (Time) — the cross-module
    // path that makes this platform worth more than two separate tools.
    const res = await orchestrator.ask(actor, {
      message: 'How many hours have gone into the KPI dashboard project?',
    });

    expect(res.answer).toMatch(/\b5\b/);
    expect(res.toolCalls.map((t) => t.toolName)).toContain('time_project_hours');
  });

  it('declines to invent a client it cannot find', { timeout: 60_000 }, async () => {
    const res = await orchestrator.ask(actor, {
      message: 'How many hours did we log for Globex Industries?',
    });

    // The failure mode that matters: confidently reporting numbers for a client that
    // does not exist. It must say it found nothing.
    expect(res.answer.toLowerCase()).toMatch(/no|not|don't|does not|cannot|couldn't/);
    expect(res.answer).not.toMatch(/\d+\s*hours? (have|were) logged for Globex/i);
  });

  it('keeps conversation context across turns', { timeout: 90_000 }, async () => {
    const first = await orchestrator.ask(actor, { message: 'Which clients do we have?' });
    const second = await orchestrator.ask(actor, {
      conversationId: first.conversationId,
      message: 'What projects does the first one have?',
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.answer.toLowerCase()).toContain('kpi');
  });

  it('records every turn with the tools it used', { timeout: 60_000 }, async () => {
    const res = await orchestrator.ask(actor, { message: 'Which clients do we have?' });
    const stored = await orchestrator.getConversation(actor, res.conversationId);

    // "Who created this?" must stay answerable — the conversation is half that answer.
    expect(stored.messages).toHaveLength(2);
    expect(stored.messages[1]!.toolCalls).not.toEqual([]);
  });
});
