import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { boardFiles, boards, elements } from './whiteboard.schema.js';

/**
 * The largest screenshot that can be pasted onto a board.
 *
 * `main.ts` sets the JSON body limit to 14 MB and base64 inflates by four thirds, so 10 MB is
 * the largest that actually fits — and it is the cap meeting-note images already use.
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** What a client sends up, and what the authority holds. See `packages/board-doc`. */
export interface StoredElement {
  id: string;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted?: boolean;
  type: string;
  [key: string]: unknown;
}

export interface CreateBoardInput {
  title?: string;
  meetingId?: string | null;
}

/**
 * Whiteboards.
 *
 * The published API of the module: metadata here, and the scene as a load/save pair the
 * document authority binds itself to. Nothing else may reach into the tables.
 *
 * The split matters. `create` and `archive` are the transactional writes — registry, audit and
 * event in one go, like every other module. `saveScene` is not one of those: it is a content
 * update to an entity that is already registered, exactly as a note body flush is, and running
 * it through the audit log would turn that log into a keystroke recorder.
 */
@Injectable()
export class WhiteboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
    private readonly storage: StorageService,
  ) {}

  // ── boards ──

  async create(actor: Actor, input: CreateBoardInput = {}) {
    await this.require(actor, 'whiteboard.write');

    const title = input.title?.trim() || 'Untitled whiteboard';
    const id = this.registry.newId();

    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'whiteboard',
        displayName: title,
        urlPath: `/whiteboards/${id}`,
      });

      await tx.insert(boards).values({
        id,
        title,
        meetingId: input.meetingId ?? null,
        createdBy: actor.userId,
      });

      // So the board surfaces on the meeting's timeline rather than only in the library.
      if (input.meetingId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: input.meetingId,
          kind: 'about',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'whiteboard.create',
        entityType: 'whiteboard',
        entityId: id,
        detail: { meetingId: input.meetingId ?? null },
      });

      await this.events.publish(tx, {
        name: 'whiteboard.created',
        entityType: 'whiteboard',
        entityId: id,
        actorId: actor.userId,
        payload: { title, meetingId: input.meetingId ?? null },
      });
    });

    return this.get(actor, id);
  }

  async get(actor: Actor, id: string) {
    await this.require(actor, 'whiteboard.read');
    const [board] = await this.db.select().from(boards).where(eq(boards.id, id)).limit(1);
    if (!board) throw new NotFoundException('No such whiteboard');
    return board;
  }

  async list(actor: Actor, filter: { meetingId?: string; archived?: boolean } = {}) {
    await this.require(actor, 'whiteboard.read');

    const where = [filter.archived ? undefined : isNull(boards.archivedAt)];
    if (filter.meetingId) where.push(eq(boards.meetingId, filter.meetingId));

    return this.db
      .select()
      .from(boards)
      .where(and(...where.filter(Boolean)))
      // Last drawn on, not last renamed — see `lastActivityAt` in the schema. Nulls last so a
      // board nobody has drawn on yet does not sit above the one everyone is using.
      .orderBy(sql`${boards.lastActivityAt} DESC NULLS LAST`, desc(boards.createdAt));
  }

  async rename(actor: Actor, id: string, title: string) {
    await this.require(actor, 'whiteboard.write');
    const trimmed = title?.trim();
    if (!trimmed) throw new BadRequestException('A whiteboard needs a title');
    await this.get(actor, id);

    await this.db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ title: trimmed, updatedAt: new Date() })
        .where(eq(boards.id, id));
      await this.registry.updateDisplay(tx, id, { displayName: trimmed });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'whiteboard.rename',
        entityType: 'whiteboard',
        entityId: id,
        detail: { title: trimmed },
      });
    });

    return this.get(actor, id);
  }

  async archive(actor: Actor, id: string) {
    await this.require(actor, 'whiteboard.delete');
    await this.get(actor, id);

    await this.db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(boards.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'whiteboard.archive',
        entityType: 'whiteboard',
        entityId: id,
        detail: {},
      });
      await this.events.publish(tx, {
        name: 'whiteboard.archived',
        entityType: 'whiteboard',
        entityId: id,
        actorId: actor.userId,
        payload: {},
      });
    });
  }

  /**
   * May this actor draw?
   *
   * Public because the board socket has to answer it when somebody connects, not when their
   * first stroke is eventually flushed. The authority writes long after the pointer moved, so
   * a permission failure there would surface as a board that quietly stops saving rather than
   * as a refused connection — the same reasoning as `MeetingsService.assertCanWrite`.
   */
  async assertCanWrite(actor: Actor): Promise<void> {
    await this.require(actor, 'whiteboard.write');
  }

  // ── the scene, for the document authority ──

  /**
   * Every element of a board, tombstones included.
   *
   * The tombstones are not an oversight. A client that deleted something while its socket was
   * down has to be told the deletion happened; handed a scene that simply omits the element it
   * would keep its own copy and quietly resurrect it.
   */
  async loadScene(boardId: string): Promise<{ elements: StoredElement[]; appState: unknown }> {
    const [board] = await this.db
      .select({ appState: boards.appState })
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1);
    if (!board) throw new NotFoundException('No such whiteboard');

    const rows = await this.db
      .select({ payload: elements.payload })
      .from(elements)
      .where(eq(elements.boardId, boardId));

    return { elements: rows.map((r) => r.payload as StoredElement), appState: board.appState };
  }

  /**
   * Write back only the elements that changed.
   *
   * One statement, however many elements. The `WHERE excluded.version >= …` on the update is
   * belt-and-braces: the authority never flushes an older version over a newer one, but a
   * second API process would not know that, and losing somebody's work to a race nobody
   * watches for is worse than a redundant predicate.
   */
  async saveScene(
    boardId: string,
    changed: StoredElement[],
    appState: unknown | undefined,
    actor: Actor,
  ): Promise<void> {
    if (changed.length > 0) {
      await this.db
        .insert(elements)
        .values(
          changed.map((el) => ({
            boardId,
            elementId: el.id,
            version: el.version,
            versionNonce: el.versionNonce,
            updated: el.updated,
            isDeleted: el.isDeleted ?? false,
            type: el.type,
            payload: el,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [elements.boardId, elements.elementId],
          set: {
            version: sql`excluded.version`,
            versionNonce: sql`excluded.version_nonce`,
            updated: sql`excluded.updated`,
            isDeleted: sql`excluded.is_deleted`,
            type: sql`excluded.type`,
            payload: sql`excluded.payload`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: sql`excluded.version >= ${elements.version}`,
        });
    }

    await this.db
      .update(boards)
      .set({
        ...(appState === undefined ? {} : { appState }),
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId));
  }

  // ── images ──

  /**
   * Store a screenshot pasted onto a board.
   *
   * `fileId` is Excalidraw's own content hash, which the image element references. Two people
   * pasting the same screenshot mint the same id, so this upserts rather than storing a second
   * copy of the same megabyte.
   *
   * Deliberately NOT a Document, for the reason a note's images are not: a screenshot somebody
   * drew over is part of the board, and filing every one would bury the contracts that belong
   * in Documents. The bytes land in the same storage tree either way, so the nightly backup
   * covers them.
   */
  async putImage(
    actor: Actor,
    input: { boardId: string; fileId: string; mimeType?: string; contentBase64?: string },
  ): Promise<{ url: string; key: string }> {
    await this.require(actor, 'whiteboard.write');
    await this.get(actor, input.boardId);

    if (!input.fileId) throw new BadRequestException('fileId is required');
    if (!input.contentBase64) throw new BadRequestException('contentBase64 is required');
    if (!input.mimeType?.startsWith('image/')) {
      throw new BadRequestException('Only images can be placed on a whiteboard');
    }

    const existing = await this.db
      .select({ storageKey: boardFiles.storageKey })
      .from(boardFiles)
      .where(and(eq(boardFiles.boardId, input.boardId), eq(boardFiles.fileId, input.fileId)))
      .limit(1);
    // Re-pasting the same screenshot is common — a second copy of the bytes is not.
    if (existing[0]) return { url: this.imageUrl(existing[0].storageKey), key: existing[0].storageKey };

    const data = Buffer.from(input.contentBase64, 'base64');
    if (data.length === 0) throw new BadRequestException('Empty image');
    if (data.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Images are limited to 10 MB');
    }

    const extension = input.mimeType.split('/')[1]?.replace('+xml', '') ?? 'png';
    const stored = await this.storage.put(data, `pasted-image.${extension}`);

    await this.db
      .insert(boardFiles)
      .values({
        boardId: input.boardId,
        fileId: input.fileId,
        storageKey: stored.key,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        createdBy: actor.userId,
      })
      // Two people pasting the same screenshot at the same moment race here; whoever loses
      // keeps the bytes they already stored rather than failing the paste.
      .onConflictDoNothing();

    return { url: this.imageUrl(stored.key), key: stored.key };
  }

  /**
   * Store the board's preview picture.
   *
   * Rendered by the browser and posted here, rather than drawn server-side: producing it in
   * Node would mean running Excalidraw's renderer headless to make something a browser that
   * already has the scene can produce in one call.
   *
   * The old key is deleted after the new one is written, never before — a crash between the
   * two leaves an orphan, which is a wasted file, while the other order leaves a board whose
   * thumbnail is a broken image.
   */
  async putThumbnail(
    actor: Actor,
    boardId: string,
    input: { mimeType?: string; contentBase64?: string },
  ): Promise<{ url: string }> {
    await this.require(actor, 'whiteboard.write');
    const board = await this.get(actor, boardId);

    if (!input.contentBase64) throw new BadRequestException('contentBase64 is required');
    if (input.mimeType !== 'image/png') {
      throw new BadRequestException('Thumbnails are PNG');
    }

    const data = Buffer.from(input.contentBase64, 'base64');
    if (data.length === 0) throw new BadRequestException('Empty thumbnail');
    // A preview tile. Anything larger is a full-size export sent to the wrong endpoint.
    if (data.length > 2 * 1024 * 1024) throw new BadRequestException('Thumbnails are limited to 2 MB');

    const stored = await this.storage.put(data, 'thumbnail.png');
    await this.db
      .update(boards)
      .set({ thumbnailKey: stored.key })
      .where(eq(boards.id, boardId));

    if (board.thumbnailKey && board.thumbnailKey !== stored.key) {
      await this.storage.delete(board.thumbnailKey).catch(() => undefined);
    }

    return { url: this.imageUrl(stored.key) };
  }

  /** Where the images a board's elements reference actually live. */
  async filesFor(actor: Actor, boardId: string, fileIds?: string[]) {
    await this.get(actor, boardId);

    const where = [eq(boardFiles.boardId, boardId)];
    if (fileIds?.length) where.push(inArray(boardFiles.fileId, fileIds));

    const rows = await this.db
      .select({
        fileId: boardFiles.fileId,
        storageKey: boardFiles.storageKey,
        mimeType: boardFiles.mimeType,
      })
      .from(boardFiles)
      .where(and(...where));

    return rows.map((r) => ({
      fileId: r.fileId,
      mimeType: r.mimeType,
      url: this.imageUrl(r.storageKey),
    }));
  }

  private imageUrl(key: string): string {
    return `/api/whiteboard/images/${encodeURIComponent(key)}`;
  }

  // ── AI tools ──

  async listTool(actor: Actor, input: { meetingId?: string; limit?: number }) {
    const rows = await this.list(actor, { meetingId: input.meetingId });
    return rows.slice(0, input.limit ?? 20).map((b) => ({
      id: b.id,
      title: b.title,
      meetingId: b.meetingId,
      lastActivityAt: b.lastActivityAt,
    }));
  }

  /**
   * The text on a board, in reading order.
   *
   * Raw element order is creation order, which reads as word salad. Sorting by y then x with a
   * tolerance band recovers something a person would recognise as the board — rows of stickies
   * read across, then down. Shapes are skipped and the tool description says so, because a
   * tool honest about what it cannot see beats one that is confidently wrong.
   */
  async readTool(actor: Actor, input: { boardId: string }) {
    await this.get(actor, input.boardId);
    const { elements: all } = await this.loadScene(input.boardId);

    const text = all
      .filter((el) => !el.isDeleted && el.type === 'text' && typeof el.text === 'string')
      .map((el) => ({
        text: (el.text as string).trim(),
        x: typeof el.x === 'number' ? el.x : 0,
        y: typeof el.y === 'number' ? el.y : 0,
      }))
      .filter((el) => el.text.length > 0);

    // Half a sticky note. Two labels within this of each other are the same row.
    const ROW_TOLERANCE = 40;
    text.sort((a, b) =>
      Math.abs(a.y - b.y) <= ROW_TOLERANCE ? a.x - b.x : a.y - b.y,
    );

    return { boardId: input.boardId, text: text.map((t) => t.text) };
  }

  // ── plumbing ──

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new BadRequestException(`Missing capability ${capability}`);
    }
  }

  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS whiteboard.v_boards CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW whiteboard.v_boards AS
      SELECT b.id, b.title, b.meeting_id, b.created_by, b.created_at,
             b.last_activity_at, b.archived_at,
             (SELECT count(*) FROM whiteboard.elements e
               WHERE e.board_id = b.id AND e.is_deleted = false) AS element_count
        FROM whiteboard.boards b
    `);
  }
}
