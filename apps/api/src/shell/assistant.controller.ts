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

  /**
   * The list, narrowed however the caller asks.
   *
   * Every filter is a query parameter rather than a separate endpoint, because a saved search
   * stores exactly this shape — one query language, whether it is typed now or remembered.
   */
  @Get('conversations')
  list(@CurrentActor() actor: Actor, @Query() query: Record<string, string>) {
    return this.orchestrator.listConversations(actor, {
      q: query.q,
      folderId: query.folderId as string | 'none' | undefined,
      tagId: query.tagId,
      subjectId: query.subjectId,
      usedTool: query.usedTool,
      since: query.since,
      until: query.until,
      pinnedOnly: query.pinnedOnly === 'true',
      includeArchived: query.includeArchived === 'true',
      archivedOnly: query.archivedOnly === 'true',
      sort: query.sort as 'recent' | 'oldest' | 'title' | undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Post('conversations/:id/archive')
  archive(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { archived?: boolean },
  ) {
    return this.orchestrator.archiveConversation(actor, id, body.archived !== false);
  }

  /** One action, many conversations — filing sixty-seven of them one at a time is why nobody does. */
  @Post('conversations/bulk')
  bulk(
    @CurrentActor() actor: Actor,
    @Body()
    body: {
      ids: string[];
      move?: string | null;
      archive?: boolean;
      pin?: boolean;
      tag?: string;
      on?: boolean;
      delete?: true;
    },
  ) {
    const action =
      body.delete
        ? ({ delete: true } as const)
        : body.tag
          ? ({ tag: body.tag, on: body.on !== false } as const)
          : body.archive !== undefined
            ? ({ archive: body.archive } as const)
            : body.pin !== undefined
              ? ({ pin: body.pin } as const)
              : ({ move: body.move ?? null } as const);
    return this.orchestrator.bulkConversations(actor, body.ids ?? [], action);
  }

  /** Where this thread probably belongs, from the records its answers cited. */
  @Get('conversations/:id/suggested-subject')
  suggested(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.orchestrator.suggestSubject(actor, id);
  }

  @Post('conversations/:id/split')
  split(
    @CurrentActor() actor: Actor,
    @Param('id') _id: string,
    @Body() body: { messageId: string; title?: string },
  ) {
    return this.orchestrator.splitConversation(actor, body.messageId, body.title);
  }

  @Post('conversations/:id/merge')
  merge(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { intoId: string },
  ) {
    return this.orchestrator.mergeConversations(actor, id, body.intoId);
  }

  // ── messages ──

  @Post('messages/:id/mark')
  markMessage(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { starred?: boolean; pinned?: boolean },
  ) {
    return this.orchestrator.markMessage(actor, id, body);
  }

  @Get('starred')
  starred(@CurrentActor() actor: Actor) {
    return this.orchestrator.starredMessages(actor);
  }

  // ── tags ──

  @Get('tags')
  tags(@CurrentActor() actor: Actor) {
    return this.orchestrator.listTags(actor);
  }

  @Post('tags')
  createTag(@CurrentActor() actor: Actor, @Body() body: { name: string; colour?: string | null }) {
    return this.orchestrator.createTag(actor, body.name, body.colour);
  }

  @Delete('tags/:id')
  deleteTag(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.orchestrator.deleteTag(actor, id);
  }

  @Post('conversations/:id/tags')
  tagConversation(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { tagId: string; on?: boolean },
  ) {
    return this.orchestrator.tagConversation(actor, id, body.tagId, body.on !== false);
  }

  // ── saved searches ──

  @Get('views')
  views(@CurrentActor() actor: Actor) {
    return this.orchestrator.listViews(actor);
  }

  @Post('views')
  createView(
    @CurrentActor() actor: Actor,
    @Body() body: { name: string; query: Record<string, unknown> },
  ) {
    return this.orchestrator.createView(actor, body.name, body.query ?? {});
  }

  @Delete('views/:id')
  deleteView(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.orchestrator.deleteView(actor, id);
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
  createFolder(
    @CurrentActor() actor: Actor,
    @Body()
    body: { name: string; parentId?: string | null; colour?: string | null; emoji?: string | null },
  ) {
    return this.orchestrator.createFolder(actor, body);
  }

  /** Name, colour, glyph, order or parent — whichever was sent. */
  @Patch('folders/:id')
  updateFolder(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      colour?: string | null;
      emoji?: string | null;
      position?: number;
      parentId?: string | null;
    },
  ) {
    return this.orchestrator.updateFolder(actor, id, body);
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
