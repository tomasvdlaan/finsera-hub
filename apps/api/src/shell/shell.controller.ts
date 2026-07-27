import { Body, Controller, Delete, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import type { Actor, CreateLinkInput } from '@platform/contracts';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import { Public } from '../core/auth/public.decorator.js';
import { UserService } from '../core/auth/user.service.js';
import { EventDispatcher } from '../core/events/event-dispatcher.service.js';
import { LinkService } from '../core/links/link.service.js';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { TimelineService } from './timeline.service.js';

@Controller('core')
export class ShellController {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly users: UserService,
    private readonly links: LinkService,
    private readonly timeline: TimelineService,
    private readonly dispatcher: EventDispatcher,
  ) {}

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

  /** Navigation assembled from module manifests — the shell knows no module by name. */
  @Get('navigation')
  navigation() {
    return this.manifests.all().flatMap((m) => m.navigation.map((n) => ({ ...n, module: m.name })));
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
