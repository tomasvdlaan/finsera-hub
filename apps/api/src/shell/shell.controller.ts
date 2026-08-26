import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { decodeJwt } from 'jose';
import { NAV_SECTIONS } from '@platform/contracts';
import type { Actor, CreateLinkInput } from '@platform/contracts';
import { CommentService } from '../core/comments/comment.service.js';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import { Public } from '../core/auth/public.decorator.js';
import { UserService } from '../core/auth/user.service.js';
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
    private readonly timeline: TimelineService,
    private readonly dispatcher: EventDispatcher,
    private readonly settings: SettingsService,
    private readonly dashboards: DashboardService,
    private readonly permissions: PermissionService,
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
    return { status: 'ok' };
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
    };
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
  @Get('people')
  async people(@CurrentActor() actor: Actor) {
    await this.permissions.require(actor, 'core.people.manage');
    return this.users.people(actor);
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
