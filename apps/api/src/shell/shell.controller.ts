import { Controller, ForbiddenException, Get } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import { Public } from '../core/auth/public.decorator.js';
import { UserService } from '../core/auth/user.service.js';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';

@Controller('core')
export class ShellController {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly users: UserService,
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
