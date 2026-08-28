import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { scrumManifest } from '../scrum/scrum.manifest.js';
import { timeManifest } from '../time/time.manifest.js';
import { meetingsManifest } from '../meetings/meetings.manifest.js';
import { whiteboardManifest } from './whiteboard.manifest.js';
import { WhiteboardService, type StoredElement } from './whiteboard.service.js';
import { boards, elements } from './whiteboard.schema.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/** A minimal element, shaped the way Excalidraw shapes one. */
const el = (id: string, version: number, over: Partial<StoredElement> = {}): StoredElement => ({
  id,
  version,
  versionNonce: 1_000 + version,
  updated: 1_700_000_000_000 + version,
  type: 'rectangle',
  x: 0,
  y: 0,
  ...over,
});

describe('WhiteboardService', () => {
  let whiteboards: WhiteboardService;
  let storage: StorageService;

  beforeEach(async () => {
    await resetDb();
    await truncate(
      sql`TRUNCATE whiteboard.board_files, whiteboard.elements, whiteboard.boards CASCADE`,
    );
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    // meetings comes along because whiteboard's structuralRef names meeting_note, and seal()
    // refuses a reference to an entity type no manifest declares.
    for (const m of [crmManifest, timeManifest, scrumManifest, meetingsManifest, whiteboardManifest]) {
      manifests.register(m);
    }
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    storage = new StorageService();
    whiteboards = new WhiteboardService(
      testDb, registry, permissions, audit, bus, links, storage,
    );
    await whiteboards.ensureReportingViews();
  });

  describe('create', () => {
    it('registers, audits and publishes in one go', async () => {
      const board = await whiteboards.create(actor, { title: 'Architecture' });

      expect(board.title).toBe('Architecture');

      const entity = await testDb.execute(
        sql`SELECT entity_type, display_name, url_path FROM core.entities WHERE id = ${board.id}`,
      );
      expect(entity.rows[0]).toMatchObject({
        entity_type: 'whiteboard',
        display_name: 'Architecture',
        url_path: `/whiteboards/${board.id}`,
      });

      const audited = await testDb.execute(
        sql`SELECT action FROM core.audit_log WHERE entity_id = ${board.id}`,
      );
      expect(audited.rows.map((r) => r.action)).toContain('whiteboard.create');

      const events = await testDb.execute(
        sql`SELECT event_name FROM core.events WHERE entity_id = ${board.id}`,
      );
      expect(events.rows.map((r) => r.event_name)).toContain('whiteboard.created');
    });

    it('gives an untitled board a name rather than an empty one', async () => {
      const board = await whiteboards.create(actor, {});
      expect(board.title).toBe('Untitled whiteboard');
    });

    it('links a board to the meeting it was drawn in, so it reaches that timeline', async () => {
      const meetingId = crypto.randomUUID();
      // The link table needs both ends to exist in the registry.
      await testDb.execute(sql`
        INSERT INTO core.entities (id, entity_type, display_name, url_path, owning_module)
        VALUES (${meetingId}, 'meeting_note', 'Kickoff', '/meetings/x', 'meetings')
      `);

      const board = await whiteboards.create(actor, { title: 'Kickoff sketch', meetingId });

      const linked = await testDb.execute(
        sql`SELECT to_id FROM core.links WHERE from_id = ${board.id}`,
      );
      expect(linked.rows.map((r) => r.to_id)).toContain(meetingId);
    });
  });

  describe('the scene', () => {
    it('round-trips an element unchanged', async () => {
      const board = await whiteboards.create(actor, {});
      const drawn = el('a1', 1, { strokeColor: '#1e1e1e', points: [[0, 0], [4, 9]] });

      await whiteboards.saveScene(board.id, [drawn], undefined, actor);

      const { elements: loaded } = await whiteboards.loadScene(board.id);
      expect(loaded).toEqual([drawn]);
    });

    it('keeps the higher version whichever order the writes arrive in', async () => {
      const board = await whiteboards.create(actor, {});

      await whiteboards.saveScene(board.id, [el('a1', 5)], undefined, actor);
      await whiteboards.saveScene(board.id, [el('a1', 2)], undefined, actor);

      const [row] = await testDb
        .select({ version: elements.version })
        .from(elements)
        .where(eq(elements.boardId, board.id));
      // The older write must not win. Nobody watches for this, so it has to be a test.
      expect(row?.version).toBe(5);
    });

    it('accepts a newer version over an older one', async () => {
      const board = await whiteboards.create(actor, {});

      await whiteboards.saveScene(board.id, [el('a1', 2)], undefined, actor);
      await whiteboards.saveScene(board.id, [el('a1', 5)], undefined, actor);

      const [row] = await testDb
        .select({ version: elements.version })
        .from(elements)
        .where(eq(elements.boardId, board.id));
      expect(row?.version).toBe(5);
    });

    it('keeps a tombstone a later save does not mention', async () => {
      const board = await whiteboards.create(actor, {});
      await whiteboards.saveScene(board.id, [el('gone', 2, { isDeleted: true })], undefined, actor);
      await whiteboards.saveScene(board.id, [el('other', 1)], undefined, actor);

      const { elements: loaded } = await whiteboards.loadScene(board.id);
      // Drop the tombstone and the next client to join never learns of the deletion, keeps
      // its own copy, and quietly resurrects the element.
      expect(loaded.find((e) => e.id === 'gone')?.isDeleted).toBe(true);
    });

    it('marks the board as drawn on', async () => {
      const board = await whiteboards.create(actor, {});
      expect(board.lastActivityAt).toBeNull();

      await whiteboards.saveScene(board.id, [el('a1', 1)], undefined, actor);

      const after = await whiteboards.get(actor, board.id);
      expect(after.lastActivityAt).not.toBeNull();
    });

    it('stores no image bytes in an element row', async () => {
      const board = await whiteboards.create(actor, {});
      // What an image element actually looks like: a fileId reference, never the pixels.
      await whiteboards.saveScene(
        board.id,
        [el('img', 1, { type: 'image', fileId: 'abc123' })],
        undefined,
        actor,
      );

      const rows = await testDb.execute(
        sql`SELECT payload::text AS body FROM whiteboard.elements WHERE board_id = ${board.id}`,
      );
      expect(String(rows.rows[0]?.body)).not.toContain('data:');
    });
  });

  describe('lifecycle', () => {
    it('renames the board and the registry together', async () => {
      const board = await whiteboards.create(actor, { title: 'Old' });
      await whiteboards.rename(actor, board.id, '  New  ');

      const entity = await testDb.execute(
        sql`SELECT display_name FROM core.entities WHERE id = ${board.id}`,
      );
      // A registry that disagrees with the record is a search result that opens the wrong name.
      expect(entity.rows[0]?.display_name).toBe('New');
    });

    it('refuses an empty title', async () => {
      const board = await whiteboards.create(actor, { title: 'Keep me' });
      await expect(whiteboards.rename(actor, board.id, '   ')).rejects.toThrow(/needs a title/);
    });

    it('archives rather than deletes, and says so', async () => {
      const board = await whiteboards.create(actor, {});
      await whiteboards.archive(actor, board.id);

      const [row] = await testDb.select().from(boards).where(eq(boards.id, board.id));
      expect(row?.archivedAt).not.toBeNull();

      const events = await testDb.execute(
        sql`SELECT event_name FROM core.events WHERE entity_id = ${board.id}`,
      );
      expect(events.rows.map((r) => r.event_name)).toContain('whiteboard.archived');
    });

    it('leaves archived boards out of the library', async () => {
      const kept = await whiteboards.create(actor, { title: 'Kept' });
      const gone = await whiteboards.create(actor, { title: 'Gone' });
      await whiteboards.archive(actor, gone.id);

      const listed = await whiteboards.list(actor);
      expect(listed.map((b) => b.id)).toEqual([kept.id]);
    });

    it('has nothing to show for a board that does not exist', async () => {
      await expect(whiteboards.get(actor, crypto.randomUUID())).rejects.toThrow(/No such/);
    });
  });

  describe('reading a board', () => {
    it('returns text top-to-bottom and left-to-right, not in creation order', async () => {
      const board = await whiteboards.create(actor, {});
      await whiteboards.saveScene(
        board.id,
        [
          el('c', 1, { type: 'text', text: 'bottom', x: 0, y: 400 }),
          el('b', 1, { type: 'text', text: 'right', x: 300, y: 10 }),
          el('a', 1, { type: 'text', text: 'left', x: 0, y: 0 }),
        ],
        undefined,
        actor,
      );

      const { text } = await whiteboards.readTool(actor, { boardId: board.id });
      // 'left' and 'right' are within the row tolerance of each other, so they read across.
      expect(text).toEqual(['left', 'right', 'bottom']);
    });

    it('skips shapes, deleted text and blank labels', async () => {
      const board = await whiteboards.create(actor, {});
      await whiteboards.saveScene(
        board.id,
        [
          el('shape', 1, { type: 'rectangle' }),
          el('blank', 1, { type: 'text', text: '   ' }),
          el('dead', 1, { type: 'text', text: 'erased', isDeleted: true }),
          el('real', 1, { type: 'text', text: 'kept' }),
        ],
        undefined,
        actor,
      );

      const { text } = await whiteboards.readTool(actor, { boardId: board.id });
      expect(text).toEqual(['kept']);
    });
  });

  describe('images', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    it('stores a pasted screenshot and hands back a URL', async () => {
      const board = await whiteboards.create(actor, {});

      const stored = await whiteboards.putImage(actor, {
        boardId: board.id,
        fileId: 'hash-1',
        mimeType: 'image/png',
        contentBase64: png.toString('base64'),
      });

      expect(stored.url).toMatch(/^\/api\/whiteboard\/images\//);
      const found = await whiteboards.filesFor(actor, board.id);
      expect(found).toEqual([
        { fileId: 'hash-1', mimeType: 'image/png', url: stored.url },
      ]);
    });

    it('does not store the same screenshot twice', async () => {
      const board = await whiteboards.create(actor, {});
      const input = {
        boardId: board.id,
        fileId: 'hash-1',
        mimeType: 'image/png',
        contentBase64: png.toString('base64'),
      };

      const first = await whiteboards.putImage(actor, input);
      const second = await whiteboards.putImage(actor, input);

      // fileId is Excalidraw's content hash, so a re-paste is the same picture. A second copy
      // would be another megabyte on disk that nothing ever reads.
      expect(second.key).toBe(first.key);
      expect(await whiteboards.filesFor(actor, board.id)).toHaveLength(1);
    });

    it('refuses anything that is not an image', async () => {
      const board = await whiteboards.create(actor, {});
      await expect(
        whiteboards.putImage(actor, {
          boardId: board.id,
          fileId: 'f',
          mimeType: 'application/x-sh',
          contentBase64: Buffer.from('rm -rf /').toString('base64'),
        }),
      ).rejects.toThrow(/Only images/);
    });

    it('refuses an image over the cap', async () => {
      const board = await whiteboards.create(actor, {});
      await expect(
        whiteboards.putImage(actor, {
          boardId: board.id,
          fileId: 'f',
          mimeType: 'image/png',
          // One byte over. main.ts allows 14 MB of JSON and base64 inflates by 4/3.
          contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
        }),
      ).rejects.toThrow(/limited to 10 MB/);
    });

    it('refuses an empty image', async () => {
      const board = await whiteboards.create(actor, {});
      await expect(
        whiteboards.putImage(actor, {
          boardId: board.id,
          fileId: 'f',
          mimeType: 'image/png',
          contentBase64: '',
        }),
      ).rejects.toThrow(/contentBase64 is required/);
    });

    it('returns only the files asked for', async () => {
      const board = await whiteboards.create(actor, {});
      for (const fileId of ['a', 'b', 'c']) {
        await whiteboards.putImage(actor, {
          boardId: board.id,
          fileId,
          mimeType: 'image/png',
          contentBase64: Buffer.from(fileId).toString('base64'),
        });
      }

      const some = await whiteboards.filesFor(actor, board.id, ['a', 'c']);
      expect(some.map((f) => f.fileId).sort()).toEqual(['a', 'c']);
    });

    it('keeps one board\'s images out of another', async () => {
      const mine = await whiteboards.create(actor, { title: 'Mine' });
      const theirs = await whiteboards.create(actor, { title: 'Theirs' });
      await whiteboards.putImage(actor, {
        boardId: mine.id,
        fileId: 'secret',
        mimeType: 'image/png',
        contentBase64: png.toString('base64'),
      });

      expect(await whiteboards.filesFor(actor, theirs.id)).toEqual([]);
    });
  });

  describe('thumbnails', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    it('stores a preview and points the board at it', async () => {
      const board = await whiteboards.create(actor, {});

      const { url } = await whiteboards.putThumbnail(actor, board.id, {
        mimeType: 'image/png',
        contentBase64: png.toString('base64'),
      });

      const after = await whiteboards.get(actor, board.id);
      expect(after.thumbnailKey).toBeTruthy();
      expect(url).toContain(encodeURIComponent(after.thumbnailKey!));
    });

    it('removes the picture it replaced rather than leaving it on disk for ever', async () => {
      const board = await whiteboards.create(actor, {});
      await whiteboards.putThumbnail(actor, board.id, {
        mimeType: 'image/png',
        contentBase64: png.toString('base64'),
      });
      const first = (await whiteboards.get(actor, board.id)).thumbnailKey!;

      await whiteboards.putThumbnail(actor, board.id, {
        mimeType: 'image/png',
        contentBase64: Buffer.concat([png, Buffer.from('x')]).toString('base64'),
      });
      const second = (await whiteboards.get(actor, board.id)).thumbnailKey!;

      expect(second).not.toBe(first);
      expect(await storage.exists(second)).toBe(true);
      // A board redrawn weekly for a year would otherwise leave fifty dead previews behind.
      expect(await storage.exists(first)).toBe(false);
    });

    it('refuses anything that is not a PNG', async () => {
      const board = await whiteboards.create(actor, {});
      await expect(
        whiteboards.putThumbnail(actor, board.id, {
          mimeType: 'image/jpeg',
          contentBase64: png.toString('base64'),
        }),
      ).rejects.toThrow(/Thumbnails are PNG/);
    });

    it('refuses a full-size export sent to the wrong endpoint', async () => {
      const board = await whiteboards.create(actor, {});
      await expect(
        whiteboards.putThumbnail(actor, board.id, {
          mimeType: 'image/png',
          contentBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'),
        }),
      ).rejects.toThrow(/limited to 2 MB/);
    });
  });
});
