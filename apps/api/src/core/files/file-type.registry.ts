import { Injectable, Logger } from '@nestjs/common';
import { builtInHandlers } from './handlers.js';
import type { FileTypeHandler, Preview } from './file-type.js';

/**
 * The file-type registry.
 *
 * Everything the platform does with a file goes through here, so adding a format is
 * writing a handler and calling register() — storage, documents, search and the UI are
 * written in terms of extract/preview, never in terms of formats.
 *
 * Same shape as the module manifest and LLM provider seams: capability is declared, the
 * core composes it.
 */
@Injectable()
export class FileTypeRegistry {
  private readonly logger = new Logger(FileTypeRegistry.name);
  private readonly handlers: FileTypeHandler[] = [...builtInHandlers];

  /**
   * Add a handler. Registered first so a later, more specific handler can take
   * precedence over a built-in general one (e.g. a dedicated CSV viewer over `text`).
   */
  register(handler: FileTypeHandler): void {
    if (this.handlers.some((h) => h.id === handler.id)) {
      throw new Error(`File-type handler '${handler.id}' is already registered.`);
    }
    this.handlers.unshift(handler);
    this.logger.log(`Registered file-type handler '${handler.id}' (${handler.label})`);
  }

  resolve(mimeType: string, filename = ''): FileTypeHandler | null {
    return this.handlers.find((h) => h.matches((mimeType || '').toLowerCase(), filename)) ?? null;
  }

  /** True when the format can be searched inside. */
  canExtract(mimeType: string, filename = ''): boolean {
    return Boolean(this.resolve(mimeType, filename)?.extract);
  }

  /**
   * Extract text for search. Best-effort by design: a corrupt or password-protected file
   * is stored and downloadable, just not searchable inside — never a failed upload.
   */
  async extract(data: Buffer, mimeType: string, filename = ''): Promise<string | null> {
    const handler = this.resolve(mimeType, filename);
    if (!handler?.extract) return null;
    try {
      return await handler.extract(data);
    } catch (err) {
      this.logger.warn(`Extraction failed (${handler.id}): ${(err as Error).message}`);
      return null;
    }
  }

  async preview(data: Buffer, mimeType: string, filename = ''): Promise<Preview> {
    const handler = this.resolve(mimeType, filename);
    if (!handler?.preview) {
      return {
        kind: 'none',
        reason: handler
          ? `${handler.label} files have no preview yet — download to open it.`
          : 'This format has no preview yet — download to open it.',
      };
    }
    try {
      return await handler.preview(data, (mimeType || '').toLowerCase());
    } catch (err) {
      this.logger.warn(`Preview failed (${handler.id}): ${(err as Error).message}`);
      return { kind: 'none', reason: 'This file could not be previewed. Download to open it.' };
    }
  }

  /** What the platform can handle — surfaced on the platform documentation page. */
  describe() {
    return this.handlers.map((h) => ({
      id: h.id,
      label: h.label,
      canIndex: Boolean(h.extract),
      canPreview: Boolean(h.preview),
    }));
  }
}
