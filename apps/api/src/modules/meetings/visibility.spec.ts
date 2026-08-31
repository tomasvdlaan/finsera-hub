import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { EmbeddingService } from '../../core/llm/embedding.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { scrumManifest } from '../scrum/scrum.manifest.js';
import { ScrumService } from '../scrum/scrum.service.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { meetingsManifest } from './meetings.manifest.js';
import { UserService } from '../../core/auth/user.service.js';
import { NoteDocService } from './doc/note-doc.service.js';
import { MeetingsService } from './meetings.service.js';

/**
 * Who may see a meeting note.
 *
 * The one behaviour on this module where a bug is silent by construction: a note served to
 * somebody it was hidden from looks exactly like a note served to somebody it was not, and
 * nothing anywhere reports it. So every read path is asserted separately rather than trusting
 * that they all go through the same predicate — the point of the test is to catch the day one
 * of them stops doing so.
 */

/** The lead on the project, who writes the notes. */
const owner: Actor = { userId: crypto.randomUUID(), role: 'member' };
/** On the project team. */
const teammate: Actor = { userId: crypto.randomUUID(), role: 'member' };
/** An ordinary colleague on no relevant project. */
const outsider: Actor = { userId: crypto.randomUUID(), role: 'member' };
const boss: Actor = { userId: crypto.randomUUID(), role: 'admin' };

describe('meeting note visibility', () => {
  let crm: CrmService;
  let meetings: MeetingsService;
  let projectId: string;
  let admin: Actor;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE meetings.note_viewers, meetings.note_chunks,
                   meetings.action_items, meetings.attendees, meetings.agenda_items,
                   meetings.notes, scrum.tasks, crm.project_members,
                   crm.projects, crm.contacts, crm.clients CASCADE`);
    admin = { userId: crypto.randomUUID(), role: 'admin' };
    await seedUser(admin.userId, 'admin', 'Setup');
    await seedUser(owner.userId, 'member', 'Owner');
    await seedUser(teammate.userId, 'member', 'Teammate');
    await seedUser(outsider.userId, 'member', 'Outsider');
    await seedUser(boss.userId, 'admin', 'Boss');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, scrumManifest, meetingsManifest]) {
      manifests.register(m);
    }
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    const scrum = new ScrumService(testDb, registry, permissions, audit, bus, links, crm, time);
    const docs = new NoteDocService();
    meetings = new MeetingsService(
      testDb, registry, permissions, audit, bus, links,
      new EmbeddingService(), crm, scrum, new UserService(testDb), docs,
    );

    const client = await crm.createClient(admin, { name: 'Vandenberg' });
    const project = await crm.createProject(admin, {
      name: 'Spend analytics',
      clientId: client.id,
      billingModel: 'time_and_materials',
    });
    projectId = project.id;
    await crm.addMember(admin, projectId, { userId: owner.userId, role: 'lead' });
    await crm.addMember(admin, projectId, { userId: teammate.userId });
  });

  const onProject = () =>
    meetings.create(owner, { title: 'Kick-off', projectId, meetingDate: '2026-08-01' });

  const ids = async (who: Actor) => (await meetings.list(who)).map((n: { id: string }) => n.id);

  describe('a note on a project', () => {
    it('is visible to the project team', async () => {
      const note = await onProject();
      await expect(meetings.get(teammate, note.id)).resolves.toMatchObject({ id: note.id });
      expect(await ids(teammate)).toContain(note.id);
    });

    it('is not visible to a colleague who is not on it', async () => {
      const note = await onProject();
      await expect(meetings.get(outsider, note.id)).rejects.toThrow(/not found/i);
      expect(await ids(outsider)).not.toContain(note.id);
    });

    it('stays visible to whoever wrote it, on the project or not', async () => {
      // The author is on this one, so prove it with a project they are not a member of.
      const other = await crm.createProject(admin, {
        name: 'Something else',
        clientId: (await crm.createClient(admin, { name: 'Other' })).id,
        billingModel: 'time_and_materials',
      });
      const note = await meetings.create(owner, {
        title: 'Written for a project I am not on',
        projectId: other.id,
        meetingDate: '2026-08-01',
      });
      await expect(meetings.get(owner, note.id)).resolves.toMatchObject({ id: note.id });
      await expect(meetings.get(outsider, note.id)).rejects.toThrow(/not found/i);
    });

    it('is visible to an admin who is on no project', async () => {
      const note = await onProject();
      await expect(meetings.get(boss, note.id)).resolves.toMatchObject({ id: note.id });
    });

    it('appears the moment somebody joins the project', async () => {
      const note = await onProject();
      await expect(meetings.get(outsider, note.id)).rejects.toThrow(/not found/i);
      await crm.addMember(admin, projectId, { userId: outsider.userId });
      // No cache to invalidate: memberships are resolved per call, on purpose.
      await expect(meetings.get(outsider, note.id)).resolves.toMatchObject({ id: note.id });
    });
  });

  describe('a note with no project', () => {
    it('is visible to everyone internal', async () => {
      // Fails open, deliberately: no project means no client material, and a stand-up nobody
      // linked should not vanish from the team that held it.
      const note = await meetings.create(owner, { title: 'Stand-up', meetingDate: '2026-08-01' });
      await expect(meetings.get(outsider, note.id)).resolves.toMatchObject({ id: note.id });
      expect(await ids(outsider)).toContain(note.id);
    });
  });

  describe('a restricted note', () => {
    const restricted = async () => {
      const note = await meetings.create(owner, {
        title: 'Salary review',
        projectId,
        meetingDate: '2026-08-01',
      });
      await meetings.setRestricted(owner, note.id, true);
      return note;
    };

    it('disappears from the project team that could read it a moment ago', async () => {
      const note = await restricted();
      await expect(meetings.get(teammate, note.id)).rejects.toThrow(/not found/i);
      expect(await ids(teammate)).not.toContain(note.id);
    });

    it('is not readable by an admin either', async () => {
      /*
       * The decision this file exists to hold. `restricted` is for the meeting about a
       * person, and a flag management can read through is not what its name promises —
       * somebody would put a grievance behind it. Access is granted, never held by role.
       */
      const note = await restricted();
      await expect(meetings.get(boss, note.id)).rejects.toThrow(/not found/i);
      expect(await ids(boss)).not.toContain(note.id);
    });

    it('stays readable by its author', async () => {
      const note = await restricted();
      await expect(meetings.get(owner, note.id)).resolves.toMatchObject({ id: note.id });
    });

    it('opens to somebody named, and closes again when they are removed', async () => {
      const note = await restricted();
      await meetings.addViewer(owner, note.id, teammate.userId);
      await expect(meetings.get(teammate, note.id)).resolves.toMatchObject({ id: note.id });

      await meetings.removeViewer(owner, note.id, teammate.userId);
      await expect(meetings.get(teammate, note.id)).rejects.toThrow(/not found/i);
    });

    it('can be unrestricted, and comes back to the project team', async () => {
      const note = await restricted();
      await meetings.setRestricted(owner, note.id, false);
      await expect(meetings.get(teammate, note.id)).resolves.toMatchObject({ id: note.id });
    });

    it('cannot be reached by somebody who cannot see it, not even to grant themselves access', async () => {
      const note = await restricted();
      await expect(meetings.addViewer(outsider, note.id, outsider.userId)).rejects.toThrow(
        /not found/i,
      );
      await expect(meetings.setRestricted(boss, note.id, false)).rejects.toThrow(/not found/i);
    });
  });

  describe('the reads that quote a note without opening it', () => {
    it('keeps an invisible note out of search', async () => {
      const note = await onProject();
      await meetings.update(owner, note.id, { body: 'The pemmican clause is unusual.' });

      const mine = await meetings.search(owner, 'pemmican');
      expect(mine.map((h) => String(h.id))).toContain(note.id);

      expect(await meetings.search(outsider, 'pemmican')).toEqual([]);
    });

    it('keeps its action points out of the open-actions ledger', async () => {
      // The leak here is through the quotation: the ledger prints the text of a commitment
      // made in a meeting the reader may not open.
      const note = await onProject();
      await meetings.addActionItem(owner, note.id, { text: 'Chase the pemmican supplier' });

      const theirs = await meetings.openActions(outsider);
      expect(theirs.map((a: { text: string }) => a.text)).not.toContain(
        'Chase the pemmican supplier',
      );
      const ours = await meetings.openActions(teammate);
      expect(ours.map((a: { text: string }) => a.text)).toContain('Chase the pemmican supplier');
    });
  });
});
