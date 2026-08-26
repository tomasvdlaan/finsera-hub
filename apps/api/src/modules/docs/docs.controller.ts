import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import type { Response } from 'express';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { DocsService } from './docs.service.js';

/**
 * Uploads arrive as base64 JSON rather than multipart.
 *
 * One less dependency and one less parser on an authenticated endpoint; the ~33% size
 * overhead is irrelevant for the contracts and reports this holds. Revisit if large
 * binaries ever become normal here.
 */
interface UploadBody {
  filename: string;
  mimeType: string;
  contentBase64: string;
  title?: string;
  clientId?: string;
  projectId?: string;
  category?: string;
}

@Controller('docs')
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get('documents')
  list(
    @CurrentActor() actor: Actor,
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
    @Query('query') query?: string,
  ) {
    return this.docs.listDocuments(actor, { clientId, projectId, query });
  }

  @Get('search')
  search(@CurrentActor() actor: Actor, @Query('q') q: string) {
    return this.docs.search(actor, q ?? '');
  }

  @Post('documents')
  upload(@CurrentActor() actor: Actor, @Body() body: UploadBody) {
    return this.docs.upload(actor, this.decode(body));
  }

  @Get('documents/:id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.docs.getDocument(actor, id);
  }

  @Post('documents/:id/versions')
  addVersion(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: UploadBody) {
    return this.docs.addVersion(actor, id, this.decode(body));
  }

  @Post('documents/:id/ask')
  ask(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { question: string },
  ) {
    return this.docs.askDocument(actor, id, body.question);
  }

  /** Re-embed after an embedding-model change (see DocsService.reindex). */
  /** Pull type, value and terms out of the current version and store them. */
  @Post('documents/:id/extract')
  extract(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.docs.extractTerms(actor, id);
  }

  @Post('documents/:id/reindex')
  reindex(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.docs.reindex(actor, id);
  }

  /** Structured preview: text, markdown, sanitised HTML, sheets, or "fetch the bytes". */
  @Get('documents/:id/preview')
  preview(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.docs.previewVersion(actor, id, versionId);
  }

  /** The raw bytes, inline — what the browser renders for an image or a PDF. */
  @Get('documents/:id/raw')
  async raw(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('versionId') versionId?: string,
  ) {
    const { version, data } = await this.docs.download(actor, id, versionId);
    res.setHeader('Content-Type', version.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    // Uploaded files are untrusted; stop the browser second-guessing the declared type.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  }

  @Get('documents/:id/download')
  async download(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('versionId') versionId?: string,
  ) {
    const { version, data } = await this.docs.download(actor, id, versionId);
    res.setHeader('Content-Type', version.mimeType);
    // Quotes escaped so a filename cannot break out of the header.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${version.filename.replace(/"/g, '')}"`,
    );
    res.send(data);
  }

  @Delete('documents/:id')
  async archive(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.docs.archive(actor, id);
    return { archived: true };
  }

  private decode(body: UploadBody) {
    if (!body?.contentBase64) throw new BadRequestException('contentBase64 is required');
    const data = Buffer.from(body.contentBase64, 'base64');
    if (data.length === 0) throw new BadRequestException('Empty file');
    if (data.length > 25 * 1024 * 1024) throw new BadRequestException('File exceeds 25 MB');
    return {
      filename: body.filename ?? 'untitled',
      mimeType: body.mimeType || 'application/octet-stream',
      data,
      title: body.title,
      clientId: body.clientId,
      projectId: body.projectId,
      category: body.category,
    };
  }
}
