import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { decodeJwt } from 'jose';
import { NAV_SECTIONS } from '@platform/contracts';
import { buildInfo } from './build-info.js';
import type { Actor, CreateLinkInput } from '@platform/contracts';
import { AuditService } from '../core/audit/audit.service.js';
import { CommentService } from '../core/comments/comment.service.js';
import { MentionService } from '../core/comments/mention.service.js';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import { Public } from '../core/auth/public.decorator.js';
import { UserService } from '../core/auth/user.service.js';
import { UsageService } from '../core/usage/usage.service.js';
import { ModelConfigService } from '../core/usage/model-config.service.js';
import { OpenRouterService } from '../core/usage/openrouter.service.js';
import { OrchestratorService } from '../core/llm/orchestrator.service.js';
import { DepartmentsService } from '../core/auth/departments.service.js';
import { PermissionService } from '../core/permissions/permission.service.js';
import { DashboardService } from '../core/registry/dashboard.service.js';
import { INTERNAL_ROLE, PORTAL_ROLE, roleClaims, rolesFrom } from '../core/auth/roles.js';
import { EventDispatcher } from '../core/events/event-dispatcher.service.js';
import { LinkService } from '../core/links/link.service.js';
import { SettingsService, type OrgSettings } from '../core/settings/settings.service.js';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { SearchService } from './search.service.js';
import { TimelineService } from './timeline.service.js';

@Controller('core')
export class ShellController {
  constructor(
    private readonly search: SearchService,
    private readonly manifests: ManifestRegistry,
    private readonly users: UserService,
    private readonly links: LinkService,
    private readonly comments_: CommentService,
    private readonly mentions_: MentionService,
    private readonly timeline: TimelineService,
    private readonly dispatcher: EventDispatcher,
    private readonly settings: SettingsService,
    private readonly dashboards: DashboardService,
    private readonly permissions: PermissionService,
    private readonly departments: DepartmentsService,
    private readonly usage: UsageService,
    private readonly models: ModelConfigService,
    private readonly openrouter: OpenRouterService,
    private readonly assistant: OrchestratorService,
    private readonly audit: AuditService,
  ) {}

  /** The organisation's own legal details — printed on every invoice and quote. */
  /**
   * Everything called `q`, whatever kind of thing it is.
   *
   * Behind the command bar. One endpoint rather than one per module, because the point of it
   * is that you do not have to know whether what you are looking for is a client, a note or
   * an invoice before you start typing.
   */
  @Get('search')
  async find(@CurrentActor() actor: Actor, @Query('q') q = '', @Query('limit') limit?: string) {
    const max = Math.min(Number(limit) || 20, 50);
    return { results: await this.search.find(actor, q, max) };
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  async updateSettings(
    @CurrentActor() actor: Actor,
    @Body() body: Partial<Omit<OrgSettings, 'id' | 'updatedAt'>>,
  ) {
    if (actor.role !== 'admin') throw new ForbiddenException();
    return this.settings.update(body);
  }

  /** Liveness — used by the deploy healthcheck. */
  @Public()
  @Get('health')
  health() {
    /*
     * The build, on the endpoint the deploy already polls.
     *
     * Not a new route: this one is public, is hit by `update.sh` after every deploy, and is
     * the first thing anybody curls when they want to know whether the site is alive. Making
     * it also say *which* build is alive means one request answers both questions, and the
     * deploy's own health check becomes a check that the new code is the code that answered.
     */
    return { status: 'ok', ...buildInfo() };
  }

  /** The signed-in user, resolved from the token (and provisioned on first login). */
  @Get('me')
  async me(@CurrentActor() actor: Actor) {
    const user = await this.users.byId(actor.userId);
    return {
      id: user!.id,
      email: user!.email,
      displayName: user!.displayName,
      role: user!.role,
      capabilities: await this.capabilitiesOf(actor),
    };
  }

  /**
   * Every capability this actor holds, asked of the same service that enforces them.
   *
   * Deliberately `permissions.can()` per capability rather than reimplementing the rule here.
   * The rule today is "members hold everything not marked adminOnly", and the moment that is
   * written down twice it has two versions — the one that decides what the UI offers and the
   * one that decides what the server allows. Those disagreeing is how somebody is shown a
   * control that then refuses them.
   *
   * The list is small — under fifty across eleven modules — and this is one request at sign-in.
   */
  private async capabilitiesOf(actor: Actor): Promise<string[]> {
    const declared = [
      ...new Set(this.manifests.all().flatMap((m) => m.permissions.map((p) => p.capability))),
    ];
    const held = await Promise.all(
      declared.map(async (c) => ((await this.permissions.can(actor, c)) ? c : null)),
    );
    return held.filter((c): c is string => c !== null).sort();
  }

  /**
   * What the identity provider is actually sending.
   *
   * Configuring Zitadel roles is otherwise blind: you change a switch in the console, log
   * out, log in, and find out only whether it worked — never which of four settings was
   * the missing one. This reports the claim names present in the access token, every roles
   * claim found in either the token or userinfo, and whether the role the platform
   * requires is among them.
   *
   * Claim NAMES and role KEYS only. No token, no signature, no profile values beyond the
   * roles themselves, so it stays safe to paste when asking someone for help.
   *
   * Admin-only, because it describes how authentication is wired.
   */
  @Get('auth/diagnostics')
  async authDiagnostics(@CurrentActor() actor: Actor, @Headers('authorization') header?: string) {
    if (actor.role !== 'admin') throw new ForbiddenException();

    const token = header?.replace(/^Bearer\s+/i, '') ?? '';
    let tokenClaims: Record<string, unknown> = {};
    try {
      tokenClaims = decodeJwt(token) as Record<string, unknown>;
    } catch {
      /* Reported below as an unreadable token rather than thrown — the point is to say so. */
    }

    const profile = (await this.users.fetchUserInfo(token)) as Record<string, unknown> | null;
    const inToken = roleClaims(tokenClaims);
    const inUserinfo = roleClaims(profile ?? {});
    const resolved = rolesFrom(
      Object.keys(inToken).length > 0 ? tokenClaims : (profile ?? {}),
    );

    return {
      issuer: process.env.ZITADEL_ISSUER ?? null,
      projectIdConfigured: process.env.ZITADEL_PROJECT_ID ?? null,
      requiredRole: INTERNAL_ROLE,
      portalRole: PORTAL_ROLE,
      accessToken: {
        readable: Object.keys(tokenClaims).length > 0,
        claimNames: Object.keys(tokenClaims).sort(),
        /** Audience entries — one of these is usually the project id you need above. */
        audience: tokenClaims.aud ?? null,
        roleClaims: inToken,
      },
      userinfo: {
        reachable: profile !== null,
        claimNames: Object.keys(profile ?? {}).sort(),
        roleClaims: inUserinfo,
      },
      resolvedRoles: resolved,
      /** The single answer: can a new colleague be provisioned right now? */
      wouldProvisionAColleague: resolved.includes(INTERNAL_ROLE),
    };
  }

  /**
   * Who work can be assigned to — names and ids, nothing else.
   *
   * Any signed-in member may read it. Knowing who your colleagues are is not a privilege
   * inside a company, and every screen that assigns anything needs the list.
   */
  /**
   * The people directory.
   *
   * `/core/users` next door stays as it is — names only, for assignee pickers on a dozen
   * screens. This is the managed view, and the two are separate so the second's fields never
   * arrive on a screen that only needed the first.
   */
  /**
   * What the platform spent at its providers, over a period.
   *
   * One endpoint returning every grouping the page shows, rather than four. The four answers
   * are the same rows read four ways, and splitting them would let a write land between two
   * requests and produce a total that disagrees with its own breakdown.
   *
   * Dates are inclusive-exclusive and default to the current calendar month, which is the
   * period a bill arrives for.
   */
  @Get('costs')
  async costs(
    @CurrentActor() actor: Actor,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.permissions.require(actor, 'core.costs.read');

    const now = new Date();
    const start = from ? new Date(`${from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // Exclusive: `to` names the last day a reader means to include, so the range ends at the
    // start of the day after it. Off by one here silently drops today's spending.
    const end = to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000) : now;

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('from and to must be YYYY-MM-DD dates');
    }

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      // Not period-scoped, and deliberately alongside rather than inside the totals: it is an
      // account balance, not a figure about this month.
      openrouter: await this.openrouter.credits(),
      ...(await this.usage.summary(start, end)),
    };
  }

  /**
   * Which model answers, and what else this deployment could use.
   *
   * The options come from the server rather than the client because availability depends on
   * which API keys this deployment holds — a list hard-coded in the frontend would offer a
   * choice that breaks every AI feature the moment it is picked.
   */
  @Get('models')
  async modelSettings(@CurrentActor() actor: Actor) {
    await this.permissions.require(actor, 'core.models.manage');
    return { current: await this.models.current(), options: await this.models.options() };
  }

  /**
   * What the assistant has failed on lately.
   *
   * Alongside the costs and the model picker rather than on a page of its own, because the
   * three answer one question between them: a run of failures is usually a model that has
   * been retired, an account out of credit, or a choice somebody made here — and all three
   * of those are settled on this screen.
   *
   * `core.costs.read` rather than a new capability. It is the same audience and the same
   * kind of secret: a failure carries the question that provoked it, so this is a window
   * onto what colleagues asked the assistant, which is a fact about how somebody works.
   */
  @Get('assistant/failures')
  async assistantFailures(@CurrentActor() actor: Actor, @Query('limit') limit?: string) {
    await this.permissions.require(actor, 'core.costs.read');
    return this.assistant.failures(Number(limit) || 100);
  }

  /**
   * The same thing as a file.
   *
   * The reason this exists is that the failures worth looking into are on the deployed
   * server, and the person who can fix them is not on it. A browser download from the live
   * instance is the whole transfer: no shell on the box, no database client, no copying rows
   * out of a terminal by hand.
   *
   * `Content-Disposition` is what makes it a download rather than a wall of JSON in a tab.
   * The filename carries the date, because the second thing anybody does with one of these is
   * put it next to the last one.
   */
  @Get('assistant/failures/export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  async exportAssistantFailures(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
    @Query('limit') limit?: string,
  ) {
    await this.permissions.require(actor, 'core.costs.read');
    const failures = await this.assistant.failures(Number(limit) || 1000);
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="assistant-failures-${day}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      // Which deployment this came from. Two files on one desk are otherwise indistinguishable.
      site: process.env.PUBLIC_URL ?? null,
      models: await this.models.current(),
      count: failures.length,
      failures,
    };
  }

  /** Choose a model for one slot, or send null to hand it back to the environment. */
  @Put('models/:role')
  async setModel(
    @CurrentActor() actor: Actor,
    @Param('role') role: string,
    @Body() body: { model: string | null },
  ) {
    await this.permissions.require(actor, 'core.models.manage');
    if (role !== 'strong' && role !== 'fast') {
      throw new BadRequestException("role must be 'strong' or 'fast'");
    }
    return this.models.set(role, body.model ?? null);
  }

  /**
   * The departments work can be addressed to.
   *
   * Readable by everyone, unlike the directory it sits next to: a member has to be able to
   * see that an item on their own inbox came to them as Finance, and the list is five labels
   * — it says nothing about any person.
   */
  @Get('departments')
  departmentList() {
    return this.departments.list();
  }

  @Post('departments')
  async createDepartment(@CurrentActor() actor: Actor, @Body() body: { label: string }) {
    await this.permissions.require(actor, 'core.people.manage');
    return this.departments.create(actor, { label: body?.label });
  }

  @Patch('departments/:id')
  async renameDepartment(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { label: string },
  ) {
    await this.permissions.require(actor, 'core.people.manage');
    return this.departments.rename(actor, id, body?.label);
  }

  @Delete('departments/:id')
  async deleteDepartment(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.permissions.require(actor, 'core.people.manage');
    await this.departments.remove(actor, id);
    return { deleted: true };
  }

  /**
   * Which departments somebody is in — the whole set, every time.
   *
   * A PUT rather than add/remove routes because the screen edits a set of checkboxes: two
   * endpoints would make the UI reconstruct a diff it does not have, and get it wrong the
   * first time two people were edited in two tabs.
   */
  @Put('people/:id/departments')
  async setDepartments(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { departmentIds?: string[] },
  ) {
    await this.permissions.require(actor, 'core.people.manage');
    return {
      departmentIds: await this.departments.setForUser(actor, id, body?.departmentIds ?? []),
    };
  }

  @Get('people')
  async people(@CurrentActor() actor: Actor) {
    await this.permissions.require(actor, 'core.people.manage');
    const people = await this.users.people(actor);
    /*
     * Departments are attached here rather than inside `people()`.
     *
     * UserService holds nothing but the database on purpose, and the directory projection is
     * already the one place that decides which fields leave. One join for the whole page,
     * rather than a query per row or a second call from the browser.
     */
    const byUser = await this.departments.byUser(people.map((p) => String(p.id)));
    return people.map((p) => ({ ...p, departmentIds: byUser.get(String(p.id)) ?? [] }));
  }

  /**
   * One colleague.
   *
   * Behind the same capability as the directory: a page about a person carries their contracted
   * hours and — for an admin — their cost rate, which is the one field on the row from which a
   * salary can be inferred. Declared before `people/:id/…` nothing, but after `people`, so the
   * literal segment is never swallowed by the parameter.
   */
  @Get('people/:id')
  async person(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.permissions.require(actor, 'core.people.manage');
    const person = await this.users.person(actor, id);
    if (!person) throw new NotFoundException('No such person');
    const byUser = await this.departments.byUser([id]);
    return { ...person, departmentIds: byUser.get(id) ?? [] };
  }

  @Patch('people/:id')
  async updatePerson(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body()
    body: {
      role?: 'admin' | 'member';
      isActive?: boolean;
      jobTitle?: string | null;
      startedOn?: string | null;
      costRateCents?: number | null;
      weeklyHours?: number | null;
    },
  ) {
    await this.permissions.require(actor, 'core.people.manage');
    return this.users.updatePerson(actor, id, body);
  }

  /** Names plus contracted hours — the denominator a load chart needs, or null where unset. */
  /**
   * How much of each kind of thing exists.
   *
   * The widget picker uses it to hide widgets that cannot say anything true yet. A scatter of
   * six finished cards, a receivables chart with no issued invoice, a per-person load with one
   * person — each renders correctly and means nothing, and a library of forty options where a
   * third are structurally empty teaches people that the library is not worth opening.
   *
   * Counts only, and cheap ones: this runs on every visit to the dashboard's picker.
   */
  @Get('volume')
  async volume(@CurrentActor() actor: Actor) {
    return this.dashboards.volume(actor);
  }

  @Get('capacities')
  capacities() {
    return this.users.capacities();
  }

  @Get('users')
  users_() {
    return this.users.listAssignable();
  }

  /** Navigation assembled from module manifests — the shell knows no module by name. */
  /**
   * Every navigation entry every module declares, sorted into shell-owned sections.
   *
   * Sorting happens here rather than in the browser so the rail's order is one answer
   * rather than one per client. The shell still names no module: it reads `section` from
   * the manifest and knows nothing about what is in it.
   */
  /**
   * This person's dashboard, and how to change it.
   *
   * On the shell rather than in a module, for the same reason the navigation is: a dashboard is
   * composed of blocks from many modules and belongs to none of them, and putting it inside one
   * would make every other module's widgets that module's business.
   */
  @Get('dashboard')
  dashboard(@CurrentActor() actor: Actor) {
    return this.dashboards.get(actor);
  }

  @Put('dashboard')
  saveDashboard(@CurrentActor() actor: Actor, @Body() body: { layout: unknown }) {
    return this.dashboards.save(actor, body?.layout);
  }

  @Delete('dashboard')
  resetDashboard(@CurrentActor() actor: Actor) {
    return this.dashboards.reset(actor);
  }

  @Get('navigation')
  navigation() {
    return this.manifests
      .all()
      .flatMap((m) => m.navigation.map((n) => ({ ...n, module: m.name })))
      .map((n) => ({ ...n, section: n.section ?? 'more' }))
      .sort((a, b) => {
        const bySection = NAV_SECTIONS.indexOf(a.section) - NAV_SECTIONS.indexOf(b.section);
        if (bySection !== 0) return bySection;
        const byOrder = (a.order ?? 100) - (b.order ?? 100);
        return byOrder !== 0 ? byOrder : a.label.localeCompare(b.label);
      });
  }

  /**
   * Discussion on a record.
   *
   * Beside links and the timeline because it is the same kind of thing: a core capability
   * over any registry entity, belonging to no module. Permission is the subject's own — if
   * you can see the record you can discuss it — which is why no capability is named here.
   */
  /**
   * Who has named me and I have not read yet.
   *
   * `mentions` before `comments/:entityId` would be shadowed by nothing — they are different
   * paths — but it sits here because it is the same subject, and because the two routes below
   * are the only way a mention is ever cleared.
   */
  @Get('mentions')
  mentions(@CurrentActor() actor: Actor) {
    return this.mentions_.listFor(actor);
  }

  /** Mark some read, or — with no ids — everything waiting. */
  @Post('mentions/read')
  readMentions(@CurrentActor() actor: Actor, @Body() body: { ids?: string[] }) {
    return this.mentions_.markRead(actor, body?.ids);
  }

  /** Who can be named, for the picker. Active people, yourself included. */
  @Get('mentionable')
  mentionable() {
    return this.mentions_.mentionable();
  }

  @Get('comments/:entityId')
  comments(@CurrentActor() actor: Actor, @Param('entityId') entityId: string) {
    return this.comments_.listFor(actor, entityId);
  }

  @Post('comments/:entityId')
  addComment(
    @CurrentActor() actor: Actor,
    @Param('entityId') entityId: string,
    @Body() body: { body?: string; parentId?: string },
  ) {
    return this.comments_.add(actor, {
      subjectId: entityId,
      body: body?.body ?? '',
      parentId: body?.parentId,
    });
  }

  @Patch('comments/:id')
  editComment(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { body?: string },
  ) {
    return this.comments_.edit(actor, id, body?.body ?? '');
  }

  @Delete('comments/:id')
  deleteComment(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.comments_.remove(actor, id);
  }

  /** Contextual links for an entity, filtered by the both-endpoints rule. */
  @Get('links/:entityId')
  linksFor(@CurrentActor() actor: Actor, @Param('entityId') entityId: string) {
    return this.links.listFor(actor, entityId);
  }

  @Post('links')
  createLink(@CurrentActor() actor: Actor, @Body() body: CreateLinkInput) {
    return this.links.create(actor, body);
  }

  @Delete('links/:linkId')
  async removeLink(@CurrentActor() actor: Actor, @Param('linkId') linkId: string) {
    await this.links.remove(actor, linkId);
    return { removed: true };
  }

  /**
   * The activity timeline — assembled by the core from registry entries, links, and
   * events. No module contributes code to this path (Master §13).
   */
  @Get('timeline/:entityId')
  timelineFor(@CurrentActor() actor: Actor, @Param('entityId') entityId: string) {
    return this.timeline.for(actor, entityId);
  }

  /**
   * The same log with time as its axis rather than an entity.
   *
   * Exposed over HTTP as well as to the assistant because the two want the same thing for
   * different reasons — the model to answer "what happened this week", a page to show it —
   * and one of them being the only caller is how a capability ends up with no surface.
   */
  @Get('activity')
  activity(
    @CurrentActor() actor: Actor,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('entityType') entityType?: string,
    @Query('actorId') actorId?: string,
    @Query('eventName') eventName?: string,
    @Query('limit') limit?: string,
  ) {
    return this.timeline.recent(actor, {
      since,
      until,
      entityType,
      actorId,
      eventName,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Who has been here, and when — the internal platform and the client portals together.
   *
   * Separate from `/core/activity` rather than mixed into it, because the two are different
   * logs. Activity is assembled from `core.events`, and every row there is something that
   * happened *to* a registry entity; a sign-in happened to nobody, and forcing one to name
   * a subject it does not have is how a clean rule acquires its first exception.
   *
   * Behind `core.people.manage`, the same gate as the directory: this says when each named
   * colleague was at their desk, which is a fact about a person rather than about the work.
   */
  @Get('sign-ins')
  async signIns(
    @CurrentActor() actor: Actor,
    @Query('userId') userId?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    await this.permissions.require(actor, 'core.people.manage');
    return this.audit.signIns({ userId, since, limit: limit ? Number(limit) : undefined });
  }

  /** Dead-lettered event deliveries — the only ops surface in Phase 0 (spec §9). */
  @Get('events/dead')
  async deadLetters(@CurrentActor() actor: Actor) {
    if (actor.role !== 'admin') throw new ForbiddenException();
    return this.dispatcher.deadLetters();
  }

  /**
   * The platform's own documentation: every module's declared surface, straight from the
   * sealed manifests.
   *
   * Not hand-written docs — this IS the contract the core runs on, so it cannot drift
   * from reality. Event subscribers are resolved here so the page can show wiring
   * (who reacts to what) rather than just declarations.
   */
  @Get('modules')
  modules() {
    return this.manifests.all().map((m) => ({
      name: m.name,
      version: m.version,
      entities: m.entities,
      structuralRefs: m.structuralRefs,
      publishes: m.publishes.map((e) => ({
        ...e,
        subscribers: this.manifests.subscribersOf(e.name),
      })),
      subscribes: m.subscribes,
      permissions: m.permissions,
      navigation: m.navigation,
      widgets: m.widgets,
      chatWidgets: m.chatWidgets,
      reportingViews: m.reportingViews,
      portalExposure: m.portalExposure,
      aiTools: m.aiTools.map((t) => ({
        name: t.name,
        description: t.description,
        permission: t.permission,
        riskClass: t.riskClass,
      })),
    }));
  }

  /**
   * Debug view of the declared AI surface (spec §5). Admin-only; the orchestrator that
   * actually calls these tools arrives in Phase 2.
   */
  @Get('ai/tools')
  aiTools(@CurrentActor() actor: Actor) {
    if (actor.role !== 'admin') throw new ForbiddenException();
    return this.manifests.aiTools().map((t) => ({
      name: t.name,
      module: t.module,
      description: t.description,
      permission: t.permission,
      riskClass: t.riskClass,
    }));
  }
}
