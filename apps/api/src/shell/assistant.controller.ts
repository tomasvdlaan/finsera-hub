import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
  private readonly logger = new Logger(AssistantController.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly tools: AiToolRegistry,
  ) {}

  @Post('ask')
  ask(@CurrentActor() actor: Actor, @Body() body: AskInput) {
    return this.orchestrator.ask(actor, body);
  }

  /**
   * The same question, answered out loud.
   *
   * Server-sent events over the existing POST rather than a WebSocket: this is one request
   * with one response that happens to arrive in pieces, and the app's two sockets both exist
   * because something genuinely bidirectional needed them. SSE is normally a GET, and a GET
   * cannot carry a conversation and a context object without putting them in a URL — so this
   * is a POST that streams, which every browser handles through `fetch` and none through
   * `EventSource`. The client reads it with a stream reader for exactly that reason.
   *
   * `flushHeaders` matters: without it Nest buffers, and the first byte arrives with the
   * last — a stream that streams nothing, which is worse than not streaming at all because
   * it looks like it works.
   */
  @Post('ask/stream')
  async askStream(@CurrentActor() actor: Actor, @Body() body: AskInput, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Nothing between us and the browser should buffer this into a single write.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      for await (const event of this.orchestrator.askStream(actor, body)) {
        // A client that has gone away stops the model rather than paying to finish talking
        // to nobody — the one place streaming is cheaper than not streaming.
        if (res.writableEnded || res.destroyed) return;
        send(event);
      }
    } catch (e) {
      /*
       * The status line has already been sent, so this cannot become a 500.
       *
       * An error frame is the only way left to tell the client, and it must be sent rather
       * than the connection simply dropped: a reader that sees a closed stream with no
       * `done` cannot distinguish a crash from a network blip, and will show a blank answer
       * for both.
       */
      const message = (e as Error).message ?? 'The assistant failed.';
      this.logger.error(`ask/stream failed: ${message}`);
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  }

  /** `?q=` filters on titles and on what was actually said in each thread. */
  @Get('conversations')
  list(@CurrentActor() actor: Actor, @Query('q') q?: string) {
    return this.orchestrator.listConversations(actor, q);
  }

  @Patch('conversations/:id')
  rename(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { title: string },
  ) {
    return this.orchestrator.renameConversation(actor, id, body.title);
  }

  @Post('conversations/:id/pin')
  pin(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: { pinned: boolean }) {
    return this.orchestrator.pinConversation(actor, id, body.pinned !== false);
  }

  /** `folderId: null` moves it back to the top level. */
  @Post('conversations/:id/move')
  move(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { folderId: string | null },
  ) {
    return this.orchestrator.moveConversation(actor, id, body.folderId ?? null);
  }

  // ── folders ──

  @Get('folders')
  folders(@CurrentActor() actor: Actor) {
    return this.orchestrator.listFolders(actor);
  }

  @Post('folders')
  createFolder(@CurrentActor() actor: Actor, @Body() body: { name: string }) {
    return this.orchestrator.createFolder(actor, body.name);
  }

  @Patch('folders/:id')
  renameFolder(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.orchestrator.renameFolder(actor, id, body.name);
  }

  /** Deletes the folder; its conversations return to the top level rather than going with it. */
  @Delete('folders/:id')
  deleteFolder(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.orchestrator.deleteFolder(actor, id);
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
