import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { users } from '../db/core.schema.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { MentionService, namesIn } from './mention.service.js';
import { CommentService } from './comment.service.js';

const tomas: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const marijn: Actor = { userId: crypto.randomUUID(), role: 'member' };
const joris: Actor = { userId: crypto.randomUUID(), role: 'member' };

function manifests() {
  const m = new ManifestRegistry();
  m.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      entities: [
        {
          type: 'demo_item',
          displayTemplate: '{title}',
          urlPattern: '/demo/items/:id',
          readPermission: 'demo.items.read',
        },
      ],
      permissions: [{ capability: 'demo.items.read', description: 'Read demo items.' }],
    }),
  );
  m.seal();
  return m;
}

/**
 * Being named in a comment.
 *
 * The store exists because the Inbox is an insights engine — rules that sweep views and
 * resolve when the world changes — and a mention resolves when a person has read it. What is
 * worth testing is not that a row appears: it is the four ways a notification stops being
 * trustworthy, which are notifying twice, notifying yourself, notifying about something that
 * is no longer there, and letting one person clear another's.
 */
describe('mentions', () => {
  let comments: CommentService;
  let mentions: MentionService;
  let registry: RegistryService;
  let subject: string;

  beforeEach(async () => {
    await resetDb();
    await seedUser(tomas.userId, 'admin', 'Tomas');
    await seedUser(marijn.userId, 'member', 'Marijn Jansen');
    await seedUser(joris.userId, 'member', 'Joris');

    const m = manifests();
    registry = new RegistryService(testDb, m);
    mentions = new MentionService(testDb);
    comments = new CommentService(
      testDb,
      registry,
      new PermissionService(testDb, m),
      new AuditService(),
      mentions,
    );

    subject = registry.newId();
    await testDb.transaction(async (tx) => {
      await registry.register(tx, {
        id: subject,
        entityType: 'demo_item',
        displayName: 'Rework the roles and rights',
        urlPath: `/demo/items/${subject}`,
      });
    });
  });

  it('files a mention for the person named, and for nobody else', async () => {
    await comments.add(tomas, { subjectId: subject, body: 'Can you look at this @Marijn Jansen?' });

    const forMarijn = await mentions.listFor(marijn);
    expect(forMarijn).toHaveLength(1);
    expect(forMarijn[0]!.authorName).toBe('Tomas');
    // Enough to recognise it without opening anything, and where to go when you do.
    expect(forMarijn[0]!.excerpt).toContain('look at this');
    expect(forMarijn[0]!.subjectName).toBe('Rework the roles and rights');
    expect(forMarijn[0]!.url).toBe(`/demo/items/${subject}`);

    expect(await mentions.listFor(joris)).toHaveLength(0);
    expect(await mentions.listFor(tomas)).toHaveLength(0);
  });

  it('does not notify you about your own comment', async () => {
    // The check constraint says the same thing, so this is testing that nothing tries.
    await comments.add(tomas, { subjectId: subject, body: 'Note to self — @Tomas do the thing' });
    expect(await mentions.listFor(tomas)).toHaveLength(0);
  });

  it('takes the longest name, so a surname is not left trailing', async () => {
    await seedUser(crypto.randomUUID(), 'member', 'Marijn');
    const people = await mentions.mentionable();
    const named = namesIn('ping @Marijn Jansen about it', people);

    expect(named).toEqual([marijn.userId]);
  });

  it('does not read an email address as a mention', async () => {
    // The character before the @ has to be a boundary, or every address in every comment
    // names somebody.
    const people = await mentions.mentionable();
    expect(namesIn('mail tomas@Joris.nl if stuck', people)).toEqual([]);
    expect(namesIn('@Joris can you check', people)).toEqual([joris.userId]);
  });

  it('does not name somebody twice when the comment is edited', async () => {
    const c = await comments.add(tomas, {
      subjectId: subject,
      body: 'Can you look at this @Marijn Jansen',
    });
    await comments.edit(tomas, c.id, 'Can you look at this @Marijn Jansen — typo fixed');

    // One row, not two: `mentions_once` is what makes an edit safe to make.
    expect(await mentions.listFor(marijn)).toHaveLength(1);
  });

  it('picks up a name added by an edit', async () => {
    const c = await comments.add(tomas, { subjectId: subject, body: 'Looking at this' });
    expect(await mentions.listFor(joris)).toHaveLength(0);

    await comments.edit(tomas, c.id, 'Looking at this — @Joris you had a view?');
    expect(await mentions.listFor(joris)).toHaveLength(1);
  });

  it('keeps a mention that an edit removed, because it was already delivered', async () => {
    const c = await comments.add(tomas, { subjectId: subject, body: '@Joris thoughts?' });
    await comments.edit(tomas, c.id, 'Never mind, worked it out');

    // An edit is not a recall. The message reached them; pretending otherwise would mean a
    // notification you saw could vanish before you got to it.
    expect(await mentions.listFor(joris)).toHaveLength(1);
  });

  it('drops a mention whose comment was deleted', async () => {
    const c = await comments.add(tomas, { subjectId: subject, body: '@Joris look' });
    await comments.remove(tomas, c.id);

    // The row survives — comments are tombstoned, so the cascade never fires — but there is
    // nothing left to read, and an inbox entry that opens onto nothing is worse than none.
    expect(await mentions.listFor(joris)).toHaveLength(0);
  });

  it('cannot name somebody who has been deactivated', async () => {
    await testDb.update(users).set({ isActive: false }).where(eq(users.id, joris.userId));

    await comments.add(tomas, { subjectId: subject, body: '@Joris are you there' });
    expect(await mentions.listFor(joris)).toHaveLength(0);
  });

  it('clears what you have read, and only ever your own', async () => {
    await comments.add(tomas, { subjectId: subject, body: '@Joris one' });
    await comments.add(tomas, { subjectId: subject, body: '@Marijn Jansen two' });

    const jorisHas = await mentions.listFor(joris);
    // Marijn passing Joris's id must clear nothing: the actor is the filter, not a parameter.
    expect(await mentions.markRead(marijn, [jorisHas[0]!.id])).toEqual({ read: 0 });
    expect(await mentions.listFor(joris)).toHaveLength(1);

    expect(await mentions.markRead(joris)).toEqual({ read: 1 });
    expect(await mentions.listFor(joris)).toHaveLength(0);
    // Marijn's own is untouched by any of it.
    expect(await mentions.listFor(marijn)).toHaveLength(1);
  });

  it('survives a name with regex punctuation in it', async () => {
    // Display names are typed by people, and `.` and `(` are not special to a person.
    const odd = crypto.randomUUID();
    await seedUser(odd, 'member', 'J. O’Brien (contract)');
    const people = await mentions.mentionable();

    expect(namesIn('ask @J. O’Brien (contract) about it', people)).toEqual([odd]);
  });
});
