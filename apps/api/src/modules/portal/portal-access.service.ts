import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '@platform/contracts';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database, type Tx } from '../../core/db/db.module.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { portalArtefactGrants, portalArtefactVisibility, portalUsers } from './portal.schema.js';
import type { PortalStaff, PortalViewer } from './portal.projection.js';

/**
 * A staff viewer, decided here rather than by importing the shared guard.
 *
 * The projection imports this service; importing a value back out of it would close a cycle
 * that Nest's injector resolves at module-load time and node resolves at import time, and the
 * two disagree in ways that surface as an undefined dependency at boot rather than as a
 * compile error. The check is one property, and the union it narrows is the same union.
 */
const staffViewer = (viewer: PortalViewer): viewer is PortalStaff => 'staffUserId' in viewer;

/** The two things a person can be given individually. Sections are handled on the user row. */
export type ArtefactKind = 'page' | 'document';

export interface Visibility {
  mode: 'everyone' | 'restricted';
  /** `portal.users` ids. Meaningful only when restricted, but kept either way. */
  userIds: string[];
}

/**
 * Who, within one client, may open which report and which document.
 *
 * This is the *second* access question the portal asks, and it is worth being precise about
 * how small it is next to the first. "Whose data is this?" is answered by `client_id` on
 * every projection query and is not negotiable — nothing in this service can widen it, and a
 * grant across clients cannot be written down, because a grant names a `portal.users` row and
 * that row names exactly one client.
 *
 * What this adds is a division *inside* a client: the controller at DocHorse sees the margin
 * report, the two people in operations do not. Both are DocHorse; both see DocHorse's
 * invoices and projects. So the model is per-artefact rather than per-person: an artefact is
 * for everyone at its client, or for a named few, and that choice sits with the artefact
 * because that is how it is decided in practice — you publish a report and then think about
 * who it is for.
 *
 * The default is the behaviour that existed before this file: no row, everyone sees it.
 */
@Injectable()
export class PortalAccessService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The artefacts of this kind that this viewer must not be shown.
   *
   * Expressed as what to *remove* rather than what to keep, so that a caller who forgets to
   * apply it fails open on visibility and not on the client boundary — the boundary is a
   * different query's `WHERE client_id`, and it is still there. The alternative, an
   * allow-list of ids, would mean a projection that silently returned nothing the day this
   * service threw, and an empty portal looks like a bug in someone else's code.
   *
   * Small by construction: only restricted artefacts appear at all, and only for one client.
   */
  async hiddenIds(kind: ArtefactKind, viewer: PortalViewer): Promise<string[]> {
    // One of us, looking at a client's portal. A staff viewer already reads everything the
    // client can read (P5), and the point of that view is to check what has been shared —
    // hiding a report from it would mean the person who restricted it cannot see that they
    // did. To see the portal as one specific person sees it, there is the preview.
    if (staffViewer(viewer)) return [];
    return this.hiddenIdsFor(kind, viewer.clientId, viewer.portalUserId);
  }

  /**
   * The same question asked without a viewer, for the proxy.
   *
   * A report served through the proxy is not a Nest route: it is Express middleware holding a
   * resolved session, because a report's own scripts and images arrive as ordinary
   * navigations. `null` for the person means staff, and means everything is visible.
   */
  async hiddenIdsFor(
    kind: ArtefactKind,
    clientId: string,
    portalUserId: string | null,
  ): Promise<string[]> {
    if (!portalUserId) return [];

    const { rows } = await this.db.execute<{ artefact_id: string }>(sql`
      SELECT v.artefact_id
        FROM portal.artefact_visibility v
       WHERE v.client_id = ${clientId}
         AND v.kind = ${kind}
         AND v.mode = 'restricted'
         AND NOT EXISTS (
               SELECT 1 FROM portal.artefact_grants g
                WHERE g.kind = v.kind
                  AND g.artefact_id = v.artefact_id
                  AND g.portal_user_id = ${portalUserId}
             )
    `);
    return rows.map((r) => r.artefact_id);
  }

  /**
   * May this viewer open this one artefact?
   *
   * The single-artefact form, for the routes that serve bytes — a report through the proxy, a
   * document download. Those never go through the list, because the id arrives in a URL that
   * may have been guessed, forwarded or bookmarked before the restriction existed.
   */
  async maySee(kind: ArtefactKind, artefactId: string, viewer: PortalViewer): Promise<boolean> {
    if (staffViewer(viewer)) return true;
    return this.maySeeAs(kind, artefactId, viewer.portalUserId);
  }

  /** The proxy's form of the same question. `null` is staff, and staff sees everything. */
  async maySeeAs(
    kind: ArtefactKind,
    artefactId: string,
    portalUserId: string | null,
  ): Promise<boolean> {
    if (!portalUserId) return true;

    const [row] = await this.db
      .select({ mode: portalArtefactVisibility.mode })
      .from(portalArtefactVisibility)
      .where(
        and(
          eq(portalArtefactVisibility.kind, kind),
          eq(portalArtefactVisibility.artefactId, artefactId),
        ),
      )
      .limit(1);

    // No row, or an explicit 'everyone': the artefact was never divided up. The client check
    // that got us here is the only one that applies.
    if (!row || row.mode !== 'restricted') return true;

    const [grant] = await this.db
      .select({ id: portalArtefactGrants.id })
      .from(portalArtefactGrants)
      .where(
        and(
          eq(portalArtefactGrants.kind, kind),
          eq(portalArtefactGrants.artefactId, artefactId),
          eq(portalArtefactGrants.portalUserId, portalUserId),
        ),
      )
      .limit(1);
    return Boolean(grant);
  }

  // ── the internal side ──

  /** How one artefact is shared today, for the screen that changes it. */
  async get(actor: Actor, kind: ArtefactKind, artefactId: string): Promise<Visibility> {
    await this.require(actor);
    return this.read(kind, artefactId);
  }

  /** The same, for a page full of artefacts — one query rather than one per row. */
  async getMany(
    actor: Actor,
    kind: ArtefactKind,
    artefactIds: string[],
  ): Promise<Record<string, Visibility>> {
    await this.require(actor);
    if (artefactIds.length === 0) return {};

    const modes = await this.db
      .select({ id: portalArtefactVisibility.artefactId, mode: portalArtefactVisibility.mode })
      .from(portalArtefactVisibility)
      .where(
        and(
          eq(portalArtefactVisibility.kind, kind),
          inArray(portalArtefactVisibility.artefactId, artefactIds),
        ),
      );
    const grants = await this.db
      .select({ id: portalArtefactGrants.artefactId, userId: portalArtefactGrants.portalUserId })
      .from(portalArtefactGrants)
      .where(
        and(
          eq(portalArtefactGrants.kind, kind),
          inArray(portalArtefactGrants.artefactId, artefactIds),
        ),
      );

    const out: Record<string, Visibility> = {};
    for (const id of artefactIds) out[id] = { mode: 'everyone', userIds: [] };
    for (const m of modes) {
      const entry = out[m.id];
      if (entry) entry.mode = m.mode === 'restricted' ? 'restricted' : 'everyone';
    }
    for (const g of grants) out[g.id]?.userIds.push(g.userId);
    return out;
  }

  /**
   * Set who may see one artefact.
   *
   * Written as a whole state rather than as add/remove calls: the screen shows a list of
   * people with ticks, and sending the ticks is the only version of this that cannot drift
   * from what is on screen. Two people editing at once means the last save wins, which for a
   * list of three names is the right trade against the machinery that would avoid it.
   *
   * The client is taken from the artefact, never from the request, and every named person is
   * checked against it. That is what makes a cross-client grant impossible to write rather
   * than merely unusual.
   */
  async set(
    actor: Actor,
    kind: ArtefactKind,
    artefactId: string,
    input: { mode: 'everyone' | 'restricted'; userIds: string[] },
  ): Promise<Visibility> {
    await this.require(actor);

    const clientId = await this.clientOf(kind, artefactId);
    if (!clientId) throw new NotFoundException('No such artefact');

    const userIds = [...new Set(input.userIds)];
    if (userIds.length > 0) {
      const valid = await this.db
        .select({ id: portalUsers.id })
        .from(portalUsers)
        .where(and(eq(portalUsers.clientId, clientId), inArray(portalUsers.id, userIds)));
      if (valid.length !== userIds.length) {
        // Deliberately not "which one": the id came from our own screen, so a mismatch is a
        // bug or an attempt, and neither deserves a list of which ids exist.
        throw new BadRequestException('Those logins do not all belong to this client');
      }
    }

    // Restricting something to nobody is almost certainly a slip — the tick boxes were
    // cleared and the mode left alone — and it would hide a report with no trace on screen
    // of who was meant to have it.
    if (input.mode === 'restricted' && userIds.length === 0) {
      throw new BadRequestException(
        'Choose at least one person, or share it with everyone at this client',
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .insert(portalArtefactVisibility)
        .values({
          id: uuidv7(),
          clientId,
          kind,
          artefactId,
          mode: input.mode,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: [portalArtefactVisibility.kind, portalArtefactVisibility.artefactId],
          set: { mode: input.mode, updatedBy: actor.userId, updatedAt: new Date() },
        });

      await tx
        .delete(portalArtefactGrants)
        .where(
          and(eq(portalArtefactGrants.kind, kind), eq(portalArtefactGrants.artefactId, artefactId)),
        );
      if (userIds.length > 0) {
        await tx.insert(portalArtefactGrants).values(
          userIds.map((portalUserId) => ({
            id: uuidv7(),
            kind,
            artefactId,
            portalUserId,
            grantedBy: actor.userId,
          })),
        );
      }

      // Against the client, not the artefact: "who can see what at DocHorse" is asked while
      // looking at DocHorse, and the artefact id is in the detail for anyone following one
      // report's history.
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.visibility.set',
        entityType: 'client',
        entityId: clientId,
        detail: { kind, artefactId, mode: input.mode, userIds },
      });
    });

    return { mode: input.mode, userIds };
  }

  /**
   * Everything at this client that can be given to some of its people and not others.
   *
   * The reports and the shared documents in one list, because on a person's page they are one
   * question — "what can they open?" — and asking it of two endpoints would mean two loading
   * states and two ways to be half-answered.
   *
   * A document appears because it is linked to the client, which is what makes it visible in
   * the portal at all; a page because it exists. Everything else a client sees — projects,
   * tasks, tickets — is not divisible per person and is deliberately absent.
   */
  async artefactsFor(
    actor: Actor,
    clientId: string,
  ): Promise<
    Array<{
      kind: ArtefactKind;
      id: string;
      title: string;
      enabled: boolean;
      mode: 'everyone' | 'restricted';
      userIds: string[];
    }>
  > {
    await this.require(actor);

    const { rows } = await this.db.execute<{
      kind: ArtefactKind;
      id: string;
      title: string;
      enabled: boolean;
      mode: 'everyone' | 'restricted';
      user_ids: string[];
    }>(sql`
      WITH artefacts AS (
        SELECT 'page'::text AS kind, p.id, p.title, p.enabled
          FROM portal.pages p
         WHERE p.client_id = ${clientId}
        UNION ALL
        SELECT 'document'::text, d.id, d.title, true
          FROM docs.v_documents d
          JOIN core.links l ON l.from_id = d.id
         WHERE l.to_id = ${clientId}
           AND l.link_kind = 'shared_with_client'
      )
      SELECT a.kind, a.id, a.title, a.enabled,
             COALESCE(v.mode, 'everyone') AS mode,
             -- FILTER, not COALESCE around the aggregate: a LEFT JOIN that matched nothing
             -- aggregates to {NULL} rather than {}, and a null id in this list would read as
             -- a person who no longer exists.
             COALESCE(
               ARRAY_AGG(g.portal_user_id) FILTER (WHERE g.portal_user_id IS NOT NULL),
               '{}'
             ) AS user_ids
        FROM artefacts a
        LEFT JOIN portal.artefact_visibility v ON v.kind = a.kind AND v.artefact_id = a.id
        LEFT JOIN portal.artefact_grants g ON g.kind = a.kind AND g.artefact_id = a.id
       GROUP BY a.kind, a.id, a.title, a.enabled, v.mode
       ORDER BY a.kind, a.title
    `);

    return rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      title: r.title,
      enabled: r.enabled,
      mode: r.mode === 'restricted' ? 'restricted' : 'everyone',
      userIds: r.user_ids ?? [],
    }));
  }

  /**
   * Forget an artefact that no longer exists.
   *
   * Called in the same transaction that deletes the page or unshares the document. Nothing
   * cascades here — the artefacts live in other schemas — and a stale `restricted` row would
   * come back to life the day an id was reused.
   */
  async forget(tx: Tx, kind: ArtefactKind, artefactId: string): Promise<void> {
    await tx
      .delete(portalArtefactGrants)
      .where(
        and(eq(portalArtefactGrants.kind, kind), eq(portalArtefactGrants.artefactId, artefactId)),
      );
    await tx
      .delete(portalArtefactVisibility)
      .where(
        and(
          eq(portalArtefactVisibility.kind, kind),
          eq(portalArtefactVisibility.artefactId, artefactId),
        ),
      );
  }

  private async read(kind: ArtefactKind, artefactId: string): Promise<Visibility> {
    const [row] = await this.db
      .select({ mode: portalArtefactVisibility.mode })
      .from(portalArtefactVisibility)
      .where(
        and(
          eq(portalArtefactVisibility.kind, kind),
          eq(portalArtefactVisibility.artefactId, artefactId),
        ),
      )
      .limit(1);
    const grants = await this.db
      .select({ userId: portalArtefactGrants.portalUserId })
      .from(portalArtefactGrants)
      .where(
        and(eq(portalArtefactGrants.kind, kind), eq(portalArtefactGrants.artefactId, artefactId)),
      );
    return {
      mode: row?.mode === 'restricted' ? 'restricted' : 'everyone',
      userIds: grants.map((g) => g.userId),
    };
  }

  /**
   * Whose artefact is this — and, for a document, is it in the portal at all?
   *
   * A document becomes visible to a client by being linked to them (`shared_with_client`), so
   * that link is what makes it an artefact here. Restricting a document nobody shared would
   * write a rule about something the client cannot see, and the rule would quietly start
   * applying the day somebody shared it.
   */
  private async clientOf(kind: ArtefactKind, artefactId: string): Promise<string | null> {
    if (kind === 'page') {
      const { rows } = await this.db.execute<{ client_id: string }>(
        sql`SELECT client_id FROM portal.pages WHERE id = ${artefactId}`,
      );
      return rows[0]?.client_id ?? null;
    }
    const { rows } = await this.db.execute<{ client_id: string }>(sql`
      SELECT l.to_id AS client_id
        FROM core.links l
       WHERE l.from_id = ${artefactId}
         AND l.link_kind = 'shared_with_client'
       LIMIT 1
    `);
    return rows[0]?.client_id ?? null;
  }

  private async require(actor: Actor): Promise<void> {
    if (!(await this.permissions.can(actor, 'portal.admin'))) {
      throw new ForbiddenException("Missing capability 'portal.admin'");
    }
  }
}
