import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { Public } from '../../core/auth/public.decorator.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { imageResponseHeaders, safeStorageKey } from '../../core/storage/storage-key.js';
import { BoardDocService } from './doc/board-doc.service.js';
import {
  WhiteboardService,
  type CreateBoardInput,
  type StoredElement,
} from './whiteboard.service.js';

@Controller('whiteboard')
export class WhiteboardController {
  constructor(
    private readonly whiteboards: WhiteboardService,
    private readonly boards: BoardDocService,
    private readonly storage: StorageService,
  ) {}

  @Get('boards')
  list(
    @CurrentActor() actor: Actor,
    @Query('meetingId') meetingId?: string,
    @Query('archived') archived?: string,
  ) {
    return this.whiteboards.list(actor, { meetingId, archived: archived === 'true' });
  }

  @Post('boards')
  create(@CurrentActor() actor: Actor, @Body() body: CreateBoardInput) {
    return this.whiteboards.create(actor, body ?? {});
  }

  @Get('boards/:id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.whiteboards.get(actor, id);
  }

  @Patch('boards/:id')
  rename(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: { title: string }) {
    return this.whiteboards.rename(actor, id, body?.title);
  }

  @Delete('boards/:id')
  archive(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.whiteboards.archive(actor, id);
  }

  /**
   * The scene, from the authority rather than from the table.
   *
   * Reading the table directly would return whatever was last flushed, which is up to a second
   * behind whoever is drawing right now — so a board opened over HTTP could miss the stroke
   * that was in progress. The authority is the live copy; it hydrates from the table when
   * nobody has the board open, so this costs nothing in the quiet case.
   */
  @Get('boards/:id/scene')
  async scene(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.whiteboards.get(actor, id);
    return this.boards.snapshot(id);
  }

  /**
   * Write the scene over HTTP.
   *
   * The socket is how a board is normally saved. This is the path for a browser that could not
   * open one, and the one the editor falls back to on `beforeunload`, where there is time for a
   * fetch and not for a handshake.
   */
  @Put('boards/:id/scene')
  async saveScene(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { elements?: StoredElement[]; appState?: Record<string, unknown> },
  ) {
    await this.whiteboards.get(actor, id);
    await this.whiteboards.assertCanWrite(actor);
    /*
     * Through the authority, not straight to the table.
     *
     * A write that bypassed it would be overwritten by the next flush a second later — exactly
     * the class of silent loss the authority exists to end — and nobody with the board open
     * would see it. Routed this way it merges and broadcasts like any other change.
     */
    const accepted = await this.boards.apply(id, {
      elements: body?.elements ?? [],
      actor,
      from: 'http',
    });
    if (body?.appState) await this.boards.setAppState(id, body.appState, actor);
    return { ok: true, accepted: accepted.length };
  }

  // ── images ──

  @Post('images')
  uploadImage(
    @CurrentActor() actor: Actor,
    @Body()
    body: { boardId?: string; fileId?: string; mimeType?: string; contentBase64?: string },
  ) {
    if (!body?.boardId) throw new BadRequestException('boardId is required');
    return this.whiteboards.putImage(actor, {
      boardId: body.boardId,
      fileId: body.fileId ?? '',
      mimeType: body.mimeType,
      contentBase64: body.contentBase64,
    });
  }

  @Put('boards/:id/thumbnail')
  thumbnail(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { mimeType?: string; contentBase64?: string },
  ) {
    return this.whiteboards.putThumbnail(actor, id, body ?? {});
  }

  /** Where the images on a board live, so a peer can fetch ones it has not seen. */
  @Get('boards/:id/files')
  files(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query('ids') ids?: string,
  ) {
    return this.whiteboards.filesFor(actor, id, ids ? ids.split(',').filter(Boolean) : undefined);
  }

  /**
   * Serve an image on a board.
   *
   * Unauthenticated, and that is a trade rather than an oversight — the identical trade meeting
   * notes make, for the identical reason. An `<img src>` cannot carry an Authorization header,
   * so behind the guard every pasted screenshot renders as a broken icon: the upload succeeds,
   * the element is correct, and the picture is unreachable by the only thing that can display
   * it. Fetching each as a blob would need bespoke handling wherever a board is rendered, and
   * signed URLs need an expiry that a board kept for two years will outlive.
   *
   * What makes it acceptable is that the key is unguessable — chosen at upload, never derived
   * from the filename, the board, or anything an outsider can see. Knowing the URL is the
   * permission: there is nothing to enumerate and no id to increment. The exposure is a leaked
   * URL, the same as any capability link.
   *
   * The key is still checked rather than trusted, and the response is locked down: see
   * `imageResponseHeaders`.
   */
  @Public()
  @Get('images/*key')
  async image(@Param('key') key: string, @Res() res: Response) {
    const safe = safeStorageKey(key);
    if (!(await this.storage.exists(safe))) throw new BadRequestException('Unknown image');

    const data = await this.storage.get(safe);
    for (const [header, value] of Object.entries(imageResponseHeaders(safe))) {
      res.setHeader(header, value);
    }
    res.send(data);
  }
}
