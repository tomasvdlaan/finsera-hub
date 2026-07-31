import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { defineManifest } from '@platform/contracts';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { conversations } from '../db/core.schema.js';
import { LlmService } from './llm.service.js';
import { OrchestratorService } from './orchestrator.service.js';
import { AiToolRegistry } from './tool-registry.service.js';
import { v7 as uuidv7 } from 'uuid';

const me: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const someoneElse: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * Organising conversations.
 *
 * No model is involved in any of this — these are the rules around a conversation rather than
 * anything the assistant does — so nothing here mocks one. What is worth protecting is that a
 * thread belongs to exactly one person and that tidying never destroys an answer.
 */
describe('conversation organisation', () => {
  let orchestrator: OrchestratorService;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(
      sql`TRUNCATE core.conversations, core.conversation_folders, core.conversation_tags,
          core.conversation_views CASCADE`,
    );
    await seedUser(me.userId, 'admin');
    await seedUser(someoneElse.userId, 'admin');

    const m = new ManifestRegistry();
    m.register(defineManifest({ name: 'fixture', version: '1.0.0' }));
    m.seal();
    const registry = new RegistryService(testDb, m);
    const permissions = new PermissionService(testDb, m);
    orchestrator = new OrchestratorService(
      testDb,
      new LlmService(),
      new AiToolRegistry(m, permissions),
      registry,
      permissions,
    );
  });

  /** A conversation without going through the model. */
  const seedConversation = async (title: string, actor: Actor = me) => {
    const id = uuidv7();
    await testDb.insert(conversations).values({ id, userId: actor.userId, title });
    return id;
  };

  it('renames, and stops calling the title automatic', async () => {
    const id = await seedConversation('How many clients do we have?');
    await orchestrator.renameConversation(me, id, '  DocHorse billing  ');

    const [row] = await orchestrator.listConversations(me);
    expect(row?.title).toBe('DocHorse billing');

    // The flag is what stops the next answer's auto-title overwriting a name somebody chose.
    const [db] = await testDb.execute(
      sql`SELECT title_is_auto FROM core.conversations WHERE id = ${id}`,
    ).then((r) => r.rows as Array<{ title_is_auto: boolean }>);
    expect(db?.title_is_auto).toBe(false);
  });

  it('refuses an empty name', async () => {
    const id = await seedConversation('Something');
    await expect(orchestrator.renameConversation(me, id, '   ')).rejects.toThrow(/needs a name/i);
  });

  it('puts pinned conversations first, whatever their age', async () => {
    const older = await seedConversation('Older');
    await seedConversation('Newer');
    await orchestrator.pinConversation(me, older, true);

    expect((await orchestrator.listConversations(me)).map((c) => c.title)).toEqual([
      'Older',
      'Newer',
    ]);

    await orchestrator.pinConversation(me, older, false);
    expect((await orchestrator.listConversations(me))[0]?.title).toBe('Newer');
  });

  it('moves in and out of a folder', async () => {
    const id = await seedConversation('Invoice question');
    const folder = await orchestrator.createFolder(me, { name: 'Billing' });

    await orchestrator.moveConversation(me, id, folder.id);
    expect((await orchestrator.listConversations(me))[0]?.folderId).toBe(folder.id);

    await orchestrator.moveConversation(me, id, null);
    expect((await orchestrator.listConversations(me))[0]?.folderId).toBeNull();
  });

  it('keeps the conversations when a folder is deleted', async () => {
    const id = await seedConversation('Worth keeping');
    const folder = await orchestrator.createFolder(me, { name: 'Billing' });
    await orchestrator.moveConversation(me, id, folder.id);

    await orchestrator.deleteFolder(me, folder.id);

    // Tidying that destroys a fortnight of answers is not a feature anybody uses twice.
    const [row] = await orchestrator.listConversations(me);
    expect(row?.title).toBe('Worth keeping');
    expect(row?.folderId).toBeNull();
    expect(await orchestrator.listFolders(me)).toEqual([]);
  });

  it('searches what was said, not only what it was called', async () => {
    const id = await seedConversation('Untitled thread');
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content)
          VALUES (${uuidv7()}, ${id}, 'assistant', 'DocHorse accepted quote Q2026-0001.')`,
    );
    await seedConversation('Unrelated');

    // What people remember about an old conversation is what the assistant said in it.
    expect((await orchestrator.listConversations(me, { q: 'Q2026-0001' })).map((c) => c.id)).toEqual([id]);
    expect((await orchestrator.listConversations(me, { q: 'unrelated' })).map((c) => c.title)).toEqual([
      'Unrelated',
    ]);
    expect(await orchestrator.listConversations(me, { q: 'nothing matches this' })).toEqual([]);
  });

  it('will not let one person touch another’s conversation', async () => {
    const theirs = await seedConversation('Private', someoneElse);

    await expect(orchestrator.renameConversation(me, theirs, 'Mine now')).rejects.toThrow(
      /not found/i,
    );
    await expect(orchestrator.pinConversation(me, theirs, true)).rejects.toThrow(/not found/i);
    await expect(orchestrator.deleteConversation(me, theirs)).rejects.toThrow(/not found/i);
    expect(await orchestrator.listConversations(me)).toEqual([]);
  });

  it('will not let one person move a conversation into another’s folder', async () => {
    const mine = await seedConversation('Mine');
    const theirFolder = await orchestrator.createFolder(someoneElse, { name: 'Theirs' });

    // Two owners, two checks: the conversation is mine, the folder is not.
    await expect(orchestrator.moveConversation(me, mine, theirFolder.id)).rejects.toThrow(
      /folder not found/i,
    );
    await expect(orchestrator.renameFolder(me, theirFolder.id, 'Mine')).rejects.toThrow(
      /folder not found/i,
    );
  });

  it('shows each person only their own folders', async () => {
    await orchestrator.createFolder(me, { name: 'Billing' });
    await orchestrator.createFolder(someoneElse, { name: 'Theirs' });
    expect((await orchestrator.listFolders(me)).map((f) => f.name)).toEqual(['Billing']);
  });

  it('refuses a folder with no name', async () => {
    await expect(orchestrator.createFolder(me, { name: '  ' })).rejects.toThrow(/needs a name/i);
  });

  /*
   * Which tools an answer used, after a reload.
   *
   * They were written as `{ tool }` and read as `{ toolName }`, so a conversation showed its
   * tool chips until you refreshed and then showed a row of blank ones — losing the only
   * thing that lets an answer be checked rather than taken on trust. Both shapes are in the
   * database now and both have to come back readable.
   */
  it('returns tool calls readable however they were stored', async () => {
    const id = await seedConversation('Has history');
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content, tool_calls) VALUES
          (${uuidv7()}, ${id}, 'assistant', 'Old row',
           ${JSON.stringify([{ tool: 'crm_search_clients', module: 'crm', executed: true }])}::jsonb),
          (${uuidv7()}, ${id}, 'assistant', 'New row',
           ${JSON.stringify([{ toolName: 'activity_recent', module: 'core', executed: true }])}::jsonb)`,
    );

    const { messages: rows } = await orchestrator.getConversation(me, id);
    const names = rows.flatMap((m) =>
      (m.toolCalls as Array<{ toolName?: string }>).map((c) => c.toolName),
    );
    expect(names).toEqual(['crm_search_clients', 'activity_recent']);
  });

  it('leaves a message with no tool calls alone', async () => {
    const id = await seedConversation('Quiet');
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content)
          VALUES (${uuidv7()}, ${id}, 'assistant', 'Just an answer')`,
    );
    const { messages: rows } = await orchestrator.getConversation(me, id);
    expect(rows[0]?.toolCalls).toEqual([]);
  });

  // ── organising, beyond one flat list ────────────────────────

  it('remembers which record the question was asked from', async () => {
    // The id was already in the request and thrown away, so a chat started on a client's
    // page had no lasting connection to that client.
    const id = uuidv7();
    await testDb.insert(conversations).values({
      id,
      userId: me.userId,
      title: 'About this client',
      subjectId: null,
    });
    await testDb.execute(sql`UPDATE core.conversations SET subject_id = ${id} WHERE id = ${id}`);

    const [row] = await orchestrator.listConversations(me, { subjectId: id });
    expect(row?.id).toBe(id);
  });

  it('archives without deleting, and hides it until asked', async () => {
    const id = await seedConversation('Old business');
    await orchestrator.archiveConversation(me, id, true);

    expect(await orchestrator.listConversations(me)).toEqual([]);
    expect((await orchestrator.listConversations(me, { archivedOnly: true })).map((c) => c.id)).toEqual([id]);
    expect((await orchestrator.listConversations(me, { includeArchived: true })).map((c) => c.id)).toEqual([id]);

    await orchestrator.archiveConversation(me, id, false);
    expect((await orchestrator.listConversations(me)).map((c) => c.id)).toEqual([id]);
  });

  it('says why a search matched', async () => {
    const id = await seedConversation('Untitled');
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content)
          VALUES (${uuidv7()}, ${id}, 'assistant',
          'A long preamble that is not the interesting part at all, and then: the Snowflake credentials are with IT.')`,
    );

    // A hit with no snippet is a hit you have to open to understand.
    const [row] = await orchestrator.listConversations(me, { q: 'Snowflake' });
    expect(row?.snippet).toContain('Snowflake');
    expect(row?.snippet?.startsWith('…')).toBe(true);
  });

  it('tags a conversation, and finds it by tag', async () => {
    const id = await seedConversation('Invoice question');
    const tag = await orchestrator.createTag(me, 'billing');
    await orchestrator.tagConversation(me, id, tag.id, true);

    const [row] = await orchestrator.listConversations(me, { tagId: tag.id });
    expect(row?.tags.map((t) => t.name)).toEqual(['billing']);

    await orchestrator.tagConversation(me, id, tag.id, false);
    expect(await orchestrator.listConversations(me, { tagId: tag.id })).toEqual([]);
  });

  it('treats asking for the same tag twice as the same tag', async () => {
    const first = await orchestrator.createTag(me, 'billing');
    const again = await orchestrator.createTag(me, 'billing');
    expect(again.id).toBe(first.id);
    expect(await orchestrator.listTags(me)).toHaveLength(1);
  });

  it('nests folders one level and refuses a third', async () => {
    const top = await orchestrator.createFolder(me, { name: 'Clients' });
    const child = await orchestrator.createFolder(me, { name: 'DocHorse', parentId: top.id });

    // Two levels is a filing system; four is a maze you lose things in.
    await expect(
      orchestrator.createFolder(me, { name: 'Too deep', parentId: child.id }),
    ).rejects.toThrow(/one level/i);
  });

  it('refuses to make a folder its own parent', async () => {
    const f = await orchestrator.createFolder(me, { name: 'Loop' });
    await expect(orchestrator.updateFolder(me, f.id, { parentId: f.id })).rejects.toThrow(
      /cannot contain itself/i,
    );
  });

  it('moves, archives and tags many at once, or none', async () => {
    const a = await seedConversation('One');
    const b = await seedConversation('Two');
    const folder = await orchestrator.createFolder(me, { name: 'Billing' });

    await orchestrator.bulkConversations(me, [a, b], { move: folder.id });
    expect((await orchestrator.listConversations(me)).every((c) => c.folderId === folder.id)).toBe(true);

    // One id belonging to somebody else fails the whole batch — a half-applied bulk action
    // leaves a list nobody can reason about.
    const theirs = await seedConversation('Theirs', someoneElse);
    await expect(
      orchestrator.bulkConversations(me, [a, theirs], { archive: true }),
    ).rejects.toThrow(/not found/i);
    expect((await orchestrator.listConversations(me)).length).toBe(2);
  });

  it('suggests where a conversation belongs from what it cited', async () => {
    const id = await seedConversation('Untitled');
    const registry = new RegistryService(testDb, (() => {
      const m = new ManifestRegistry();
      m.register(
        defineManifest({
          name: 'fixture',
          version: '1.0.0',
          entities: [
            {
              type: 'fixture_thing',
              displayTemplate: '{title}',
              urlPattern: '/f/:id',
              readPermission: 'fixture.read',
            },
          ],
          permissions: [{ capability: 'fixture.read', description: 'Read.' }],
        }),
      );
      m.seal();
      return m;
    })());

    const subject = registry.newId();
    await testDb.transaction((tx) =>
      registry.register(tx, {
        id: subject,
        entityType: 'fixture_thing',
        displayName: 'DocHorse',
        urlPath: `/f/${subject}`,
      }),
    );
    const ref = { id: subject, entityType: 'fixture_thing', displayName: 'DocHorse', urlPath: `/f/${subject}`, deleted: false };
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content, "references")
          VALUES (${uuidv7()}, ${id}, 'assistant', 'a', ${JSON.stringify([ref])}::jsonb),
                 (${uuidv7()}, ${id}, 'assistant', 'b', ${JSON.stringify([ref])}::jsonb)`,
    );

    expect((await orchestrator.suggestSubject(me, id))?.displayName).toBe('DocHorse');
  });

  it('splits a thread at a message, moving the tail rather than copying it', async () => {
    const id = await seedConversation('Two subjects');
    const first = uuidv7();
    const cut = uuidv7();
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content, created_at) VALUES
          (${first}, ${id}, 'user', 'About billing', now() - interval '2 hours'),
          (${cut}, ${id}, 'user', 'Now about the board', now() - interval '1 hour')`,
    );

    const { id: newId } = await orchestrator.splitConversation(me, cut, 'Board talk');

    // Moved, not copied: a split that leaves both halves whole is a duplicate.
    expect((await orchestrator.getConversation(me, id)).messages.map((m) => m.id)).toEqual([first]);
    expect((await orchestrator.getConversation(me, newId)).messages.map((m) => m.id)).toEqual([cut]);
  });

  it('merges one thread into another and removes the emptied one', async () => {
    const a = await seedConversation('Keep');
    const b = await seedConversation('Fold in');
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content) VALUES
          (${uuidv7()}, ${a}, 'user', 'first'), (${uuidv7()}, ${b}, 'user', 'second')`,
    );

    await orchestrator.mergeConversations(me, b, a);
    expect((await orchestrator.getConversation(me, a)).messages).toHaveLength(2);
    expect((await orchestrator.listConversations(me)).map((c) => c.id)).toEqual([a]);
  });

  it('stars an answer and lists it away from its thread', async () => {
    const id = await seedConversation('Long thread');
    const msg = uuidv7();
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content)
          VALUES (${msg}, ${id}, 'assistant', 'The VAT rule, finally explained.')`,
    );

    await orchestrator.markMessage(me, msg, { starred: true });
    const [kept] = await orchestrator.starredMessages(me);
    expect(kept?.content).toContain('VAT rule');
    expect(kept?.conversationTitle).toBe('Long thread');

    await orchestrator.markMessage(me, msg, { starred: false });
    expect(await orchestrator.starredMessages(me)).toEqual([]);
  });

  it('will not let one person star another’s message', async () => {
    const theirs = await seedConversation('Private', someoneElse);
    const msg = uuidv7();
    await testDb.execute(
      sql`INSERT INTO core.messages (id, conversation_id, role, content)
          VALUES (${msg}, ${theirs}, 'assistant', 'secret')`,
    );
    await expect(orchestrator.markMessage(me, msg, { starred: true })).rejects.toThrow(/not found/i);
  });

  it('saves a search and gives it back as filters', async () => {
    const view = await orchestrator.createView(me, 'Unfiled', { folderId: 'none' });
    expect((await orchestrator.listViews(me)).map((v) => v.name)).toEqual(['Unfiled']);
    // Stored as the same shape the list takes, so a saved search needs no second language.
    expect(view.query).toEqual({ folderId: 'none' });

    await orchestrator.deleteView(me, view.id);
    expect(await orchestrator.listViews(me)).toEqual([]);
  });

  it('sorts by oldest and by title when asked', async () => {
    await seedConversation('Zebra');
    await seedConversation('Apple');
    expect((await orchestrator.listConversations(me, { sort: 'title' })).map((c) => c.title)).toEqual([
      'Apple',
      'Zebra',
    ]);
    expect((await orchestrator.listConversations(me, { sort: 'oldest' }))[0]?.title).toBe('Zebra');
  });
});
