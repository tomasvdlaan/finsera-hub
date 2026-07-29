import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { ScrumService } from '../scrum/scrum.service.js';
import { portalRequests } from './portal.schema.js';
import type { PortalVisitor } from './portal.projection.js';

const MAX_SUBJECT = 200;
const MAX_BODY = 5_000;

/** Per portal user, per hour. Generous for a person, useless for a script. */
const HOURLY_LIMIT = 10;

@Injectable()
export class PortalRequestsService {
  private readonly logger = new Logger(PortalRequestsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly scrum: ScrumService,
  ) {}

  /**
   * A client asking for something.
   *
   * The only endpoint in the portal that accepts free text, which makes it the only one
   * where the input is worth this much suspicion: length is bounded here and again by a
   * database check constraint, and the rate limit is counted from the stored rows rather
   * than held in memory — a counter in a process resets when the process does, which is
   * not a property you want in the thing standing between a client and unbounded writes.
   */
  async submit(visitor: PortalVisitor, input: { subject: string; body: string; projectId?: string }) {
    const subject = (input.subject ?? '').trim();
    const body = (input.body ?? '').trim();

    if (!subject || !body) throw new BadRequestException('Vul een onderwerp en een bericht in');
    if (subject.length > MAX_SUBJECT) {
      throw new BadRequestException(`Het onderwerp mag maximaal ${MAX_SUBJECT} tekens zijn`);
    }
    if (body.length > MAX_BODY) {
      throw new BadRequestException(`Het bericht mag maximaal ${MAX_BODY} tekens zijn`);
    }

    const { rows: counted } = await this.db.execute(sql`
      SELECT count(*)::int AS recent FROM portal.requests
       WHERE portal_user_id = ${visitor.portalUserId}
         AND created_at > now() - interval '1 hour'
    `);
    const recent = (counted[0] as { recent: number } | undefined)?.recent ?? 0;

    if (recent >= HOURLY_LIMIT) {
      this.logger.warn(`Portal request rate limit hit by ${visitor.email}`);
      throw new BadRequestException(
        'U heeft net meerdere verzoeken ingediend. Probeer het over een uur nog eens.',
      );
    }

    // A project id is accepted only if it belongs to this client. It arrives from the
    // request, so it is the one field here that could point somewhere it should not.
    let projectId: string | null = null;
    if (input.projectId) {
      const { rows } = await this.db.execute(sql`
        SELECT 1 FROM crm.v_projects WHERE id = ${input.projectId} AND client_id = ${visitor.clientId}
      `);
      if (rows.length === 0) throw new BadRequestException('Onbekend project');
      projectId = input.projectId;
    }

    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(portalRequests).values({
        id,
        clientId: visitor.clientId,
        portalUserId: visitor.portalUserId,
        subject,
        body,
        projectId,
      });
      await this.audit.record(tx, {
        actorId: null,
        action: 'portal.request',
        entityType: 'client',
        entityId: visitor.clientId,
        detail: { requestId: id, subject, email: visitor.email, viaPortal: true },
      });
    });

    this.logger.log(`Portal request from ${visitor.email}: ${subject}`);
    return { id, status: 'open' as const };
  }

  /** What this client has asked for — shown back to them so a request is not a void. */
  async forClient(visitor: PortalVisitor) {
    return this.db
      .select({
        id: portalRequests.id,
        subject: portalRequests.subject,
        status: portalRequests.status,
        createdAt: portalRequests.createdAt,
      })
      .from(portalRequests)
      .where(eq(portalRequests.clientId, visitor.clientId))
      .orderBy(desc(portalRequests.createdAt));
  }

  // ── internal ───────────────────────────────────────────────

  /** Open requests across every client, for whoever is triaging. */
  async open() {
    const { rows } = await this.db.execute(sql`
      SELECT r.id, r.subject, r.body, r.created_at, r.project_id,
             c.name AS client_name, r.client_id, u.email AS asked_by
        FROM portal.requests r
        JOIN crm.v_clients c ON c.id = r.client_id
        LEFT JOIN portal.users u ON u.id = r.portal_user_id
       WHERE r.status = 'open'
       ORDER BY r.created_at
    `);
    return rows;
  }

  /**
   * Turn a request into a task, which is where a project id finally becomes necessary.
   *
   * The internal user chooses it, having read the request. That is the whole reason a
   * request is not a task on arrival: somebody sees the client's words before they land
   * on a board the assistant reads.
   */
  async convert(actor: Actor, requestId: string, input: { projectId: string; title?: string }) {
    const [request] = await this.db
      .select()
      .from(portalRequests)
      .where(and(eq(portalRequests.id, requestId), eq(portalRequests.status, 'open')))
      .limit(1);
    if (!request) throw new NotFoundException('No such open request');

    const task = await this.scrum.createTask(actor, {
      projectId: input.projectId,
      title: input.title?.trim() || request.subject,
      // Attributed, not quoted as our own. Anyone reading this task — or any assistant
      // summarising it — should be able to tell whose words these are.
      description: `Verzoek van de klant via het portaal:\n\n${request.body}`,
    });

    await this.db.transaction(async (tx) => {
      await tx
        .update(portalRequests)
        .set({ status: 'converted', taskId: task.id, handledBy: actor.userId, handledAt: new Date() })
        .where(eq(portalRequests.id, requestId));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.request.converted',
        entityType: 'client',
        entityId: request.clientId,
        detail: { requestId, taskId: task.id },
      });
    });

    return { id: requestId, taskId: task.id, status: 'converted' as const };
  }

  async decline(actor: Actor, requestId: string) {
    const [updated] = await this.db
      .update(portalRequests)
      .set({ status: 'declined', handledBy: actor.userId, handledAt: new Date() })
      .where(and(eq(portalRequests.id, requestId), eq(portalRequests.status, 'open')))
      .returning({ id: portalRequests.id, clientId: portalRequests.clientId });
    if (!updated) throw new NotFoundException('No such open request');

    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.request.declined',
        entityType: 'client',
        entityId: updated.clientId,
        detail: { requestId },
      });
    });
    return { id: requestId, status: 'declined' as const };
  }
}
