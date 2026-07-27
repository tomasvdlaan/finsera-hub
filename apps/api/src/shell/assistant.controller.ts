import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import { AiToolRegistry } from '../core/llm/tool-registry.service.js';
import { OrchestratorService, type AskInput } from '../core/llm/orchestrator.service.js';

/**
 * The assistant's HTTP surface. Lives in the shell because the assistant is a
 * platform-wide capability, not a module.
 */
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly tools: AiToolRegistry,
  ) {}

  @Post('ask')
  ask(@CurrentActor() actor: Actor, @Body() body: AskInput) {
    return this.orchestrator.ask(actor, body);
  }

  @Get('conversations')
  list(@CurrentActor() actor: Actor) {
    return this.orchestrator.listConversations(actor);
  }

  @Get('conversations/:id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.orchestrator.getConversation(actor, id);
  }

  @Delete('conversations/:id')
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.orchestrator.deleteConversation(actor, id);
    return { deleted: true };
  }

  /** What this user's assistant can actually do — filtered by their permissions. */
  @Get('capabilities')
  capabilities(@CurrentActor() actor: Actor) {
    return this.tools.availableFor(actor);
  }
}
