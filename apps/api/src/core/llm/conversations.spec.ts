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
    await testDb.execute(sql`TRUNCATE core.conversations, core.conversation_folders CASCADE`);
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
    const folder = await orchestrator.createFolder(me, 'Billing');

    await orchestrator.moveConversation(me, id, folder.id);
    expect((await orchestrator.listConversations(me))[0]?.folderId).toBe(folder.id);

    await orchestrator.moveConversation(me, id, null);
    expect((await orchestrator.listConversations(me))[0]?.folderId).toBeNull();
  });

  it('keeps the conversations when a folder is deleted', async () => {
    const id = await seedConversation('Worth keeping');
    const folder = await orchestrator.createFolder(me, 'Billing');
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
    expect((await orchestrator.listConversations(me, 'Q2026-0001')).map((c) => c.id)).toEqual([id]);
    expect((await orchestrator.listConversations(me, 'unrelated')).map((c) => c.title)).toEqual([
      'Unrelated',
    ]);
    expect(await orchestrator.listConversations(me, 'nothing matches this')).toEqual([]);
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
    const theirFolder = await orchestrator.createFolder(someoneElse, 'Theirs');

    // Two owners, two checks: the conversation is mine, the folder is not.
    await expect(orchestrator.moveConversation(me, mine, theirFolder.id)).rejects.toThrow(
      /folder not found/i,
    );
    await expect(orchestrator.renameFolder(me, theirFolder.id, 'Mine')).rejects.toThrow(
      /folder not found/i,
    );
  });

  it('shows each person only their own folders', async () => {
    await orchestrator.createFolder(me, 'Billing');
    await orchestrator.createFolder(someoneElse, 'Theirs');
    expect((await orchestrator.listFolders(me)).map((f) => f.name)).toEqual(['Billing']);
  });

  it('refuses a folder with no name', async () => {
    await expect(orchestrator.createFolder(me, '  ')).rejects.toThrow(/needs a name/i);
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
});
