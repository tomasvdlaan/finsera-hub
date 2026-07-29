import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { CommentService } from './comment.service.js';

const me: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const someoneElse: Actor = { userId: crypto.randomUUID(), role: 'member' };

function manifests() {
  const m = new ManifestRegistry();
  m.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      entities: [{ type: 'demo_item', displayTemplate: '{title}', urlPattern: '/demo/items/:id' }],
    }),
  );
  m.seal();
  return m;
}

/**
 * Permission here is the subject's own: see the record, discuss the record.
 *
 * v0's policy is permissive, so testing against it would prove nothing about the rule. This
 * stub hides specific ids, which exercises what CommentService asks rather than what today's
 * policy happens to answer.
 */
class Hiding extends PermissionService {
  constructor(private readonly hidden: Set<string>, m: ManifestRegistry) {
    super(testDb, m);
  }
  override async canSee(actor: Actor, entityId: string): Promise<boolean> {
    return !this.hidden.has(entityId);
  }
}

describe('CommentService', () => {
  let comments: CommentService;
  let registry: RegistryService;
  let hidden: Set<string>;
  let subject: string;

  const build = () => {
    const m = manifests();
    registry = new RegistryService(testDb, m);
    hidden = new Set<string>();
    comments = new CommentService(testDb, registry, new Hiding(hidden, m), new AuditService());
  };

  const seed = async (name: string) => {
    const id = registry.newId();
    await testDb.transaction(async (tx) => {
      await registry.register(tx, {
        id,
        entityType: 'demo_item',
        displayName: name,
        urlPath: `/demo/items/${id}`,
      });
    });
    return id;
  };

  beforeEach(async () => {
    await resetDb();
    await seedUser(me.userId, 'admin');
    await seedUser(someoneElse.userId, 'member');
    build();
    subject = await seed('A task');
  });

  it('records a comment against the record and names its author', async () => {
    const c = await comments.add(me, { subjectId: subject, body: 'Waiting on the client.' });
    expect(c.body).toBe('Waiting on the client.');
    expect(c.authorName).toBe('Test User');
    expect(c.mine).toBe(true);
  });

  it('reads a thread oldest first', async () => {
    await comments.add(me, { subjectId: subject, body: 'First' });
    await comments.add(me, { subjectId: subject, body: 'Second' });
    const thread = await comments.listFor(me, subject);
    expect(thread.map((c) => c.body)).toEqual(['First', 'Second']);
  });

  it('refuses empty and oversized bodies', async () => {
    await expect(comments.add(me, { subjectId: subject, body: '   ' })).rejects.toThrow(/needs/);
    await expect(
      comments.add(me, { subjectId: subject, body: 'x'.repeat(10_001) }),
    ).rejects.toThrow(/10000/);
  });

  it('refuses a comment on a record that does not exist', async () => {
    await expect(
      comments.add(me, { subjectId: crypto.randomUUID(), body: 'Hello?' }),
    ).rejects.toThrow(/No such record/);
  });

  // ── the permission rule ──

  it('will not show a thread on a record you cannot see', async () => {
    await comments.add(me, { subjectId: subject, body: 'Internal' });
    hidden.add(subject);

    // Indistinguishable from "no comments": confirming a thread exists on a hidden record is
    // itself a disclosure about that record.
    await expect(comments.listFor(someoneElse, subject)).rejects.toThrow(/Not available/);
  });

  it('will not let you comment on a record you cannot see', async () => {
    hidden.add(subject);
    await expect(
      comments.add(someoneElse, { subjectId: subject, body: 'Sneaking in' }),
    ).rejects.toThrow(/Not available/);
  });

  // ── editing is yours alone ──

  it('lets the author edit, and marks it edited', async () => {
    const c = await comments.add(me, { subjectId: subject, body: 'Typo hree' });
    const edited = await comments.edit(me, c.id, 'Typo here');
    expect(edited.body).toBe('Typo here');
    expect(edited.editedAt).not.toBeNull();
  });

  it('will not let anyone edit somebody else’s comment', async () => {
    const c = await comments.add(me, { subjectId: subject, body: 'Mine' });
    // Reported as missing rather than forbidden: whether a comment exists that belongs to
    // someone else is not something this endpoint should confirm.
    await expect(comments.edit(someoneElse, c.id, 'Not yours')).rejects.toThrow(/No such comment/);
    expect((await comments.listFor(me, subject))[0]?.body).toBe('Mine');
  });

  it('reports someone else’s comment as not mine', async () => {
    await comments.add(someoneElse, { subjectId: subject, body: 'Theirs' });
    const [c] = await comments.listFor(me, subject);
    // Decided on the server. If the browser decided, hiding the button would be the whole
    // of the protection.
    expect(c?.mine).toBe(false);
  });

  // ── deletion keeps the thread's shape ──

  it('leaves a tombstone rather than a gap, and blanks the body', async () => {
    const c = await comments.add(me, { subjectId: subject, body: 'Said too much' });
    await comments.remove(me, c.id);

    const [after] = await comments.listFor(me, subject);
    expect(after?.deleted).toBe(true);
    expect(after?.body).toBe('');

    // Blanked in the table too — "deleted" must not mean "hidden in the UI".
    const { rows } = await testDb.execute(sql`SELECT body FROM core.comments WHERE id = ${c.id}`);
    expect((rows[0] as { body: string }).body).toBe('');
  });

  it('does not delete the same comment twice', async () => {
    const c = await comments.add(me, { subjectId: subject, body: 'Once' });
    await comments.remove(me, c.id);
    await expect(comments.remove(me, c.id)).rejects.toThrow(/No such comment/);
  });

  // ── replies ──

  it('keeps a reply with its parent', async () => {
    const parent = await comments.add(me, { subjectId: subject, body: 'Question?' });
    const reply = await comments.add(me, {
      subjectId: subject,
      body: 'Answer.',
      parentId: parent.id,
    });
    expect(reply.parentId).toBe(parent.id);
  });

  it('flattens a reply to a reply onto the same parent', async () => {
    const parent = await comments.add(me, { subjectId: subject, body: 'Top' });
    const reply = await comments.add(me, { subjectId: subject, body: 'One', parentId: parent.id });
    const deeper = await comments.add(me, { subjectId: subject, body: 'Two', parentId: reply.id });

    // One level only: a task discussion that branches is one nobody re-reads.
    expect(deeper.parentId).toBe(parent.id);
  });

  it('refuses a reply to a comment on a different record', async () => {
    const other = await seed('Another task');
    const elsewhere = await comments.add(me, { subjectId: other, body: 'Over here' });

    await expect(
      comments.add(me, { subjectId: subject, body: 'Confused', parentId: elsewhere.id }),
    ).rejects.toThrow(/does not belong/);
  });

  it('records every write in the audit log', async () => {
    const c = await comments.add(me, { subjectId: subject, body: 'One' });
    await comments.edit(me, c.id, 'Two');
    await comments.remove(me, c.id);

    const { rows } = await testDb.execute(sql`
      SELECT action FROM core.audit_log WHERE action LIKE 'comment.%' ORDER BY created_at
    `);
    // So "who changed what this said" survives the edit that changed it.
    expect(rows.map((r) => (r as { action: string }).action)).toEqual([
      'comment.create',
      'comment.edit',
      'comment.delete',
    ]);
  });
});
