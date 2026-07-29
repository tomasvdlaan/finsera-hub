import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { NAV_SECTIONS } from '@platform/contracts';
import type { Actor, CreateLinkInput } from '@platform/contracts';
import { CommentService } from '../core/comments/comment.service.js';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import { Public } from '../core/auth/public.decorator.js';
import { UserService } from '../core/auth/user.service.js';
import { EventDispatcher } from '../core/events/event-dispatcher.service.js';
import { LinkService } from '../core/links/link.service.js';
import { SettingsService, type OrgSettings } from '../core/settings/settings.service.js';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { TimelineService } from './timeline.service.js';

@Controller('core')
export class ShellController {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly users: UserService,
    private readonly links: LinkService,
    private readonly comments_: CommentService,
    private readonly timeline: TimelineService,
    private readonly dispatcher: EventDispatcher,
    private readonly settings: SettingsService,
  ) {}

  /** The organisation's own legal details — printed on every invoice and quote. */
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

  /** Navigation assembled from module manifests — the shell knows no module by name. */
  /**
   * Every navigation entry every module declares, sorted into shell-owned sections.
   *
   * Sorting happens here rather than in the browser so the rail's order is one answer
   * rather than one per client. The shell still names no module: it reads `section` from
   * the manifest and knows nothing about what is in it.
   */
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
