import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import webpush from 'web-push';
import type { Actor } from '@platform/contracts';
import { DB, type Database } from '../db/db.module.js';
import { pushDevices } from '../db/core.schema.js';

/** What the service worker receives. A sentence and a destination — never a body (brief N6). */
export interface PushPayload {
  id: string | null;
  title: string;
  url: string;
  /** Pushes with the same tag replace each other on the device rather than stacking. */
  tag: string;
  /** The Inbox number, for the icon badge on an installed app. */
  badge: number;
}

export interface DeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  /** Whether this is the browser asking — so the page can say "this device". */
  current: boolean;
}

/** Three consecutive failures that are not "gone" and the device is given up on. */
const MAX_FAILURES = 3;

/**
 * Web Push, through the browsers' own push services (Apple, Google, Mozilla). No account, no
 * fee, no SDK of a vendor's — VAPID keys identify this server, and payloads are encrypted to
 * each device's keys (RFC 8291), so the relay sees that a message exists and not what it says.
 *
 * Unconfigured — no VAPID keys — push is off and says so, rather than failing per request: the
 * Inbox works without it, and a development checkout should not need keys to run.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  readonly publicKey: string | null;

  constructor(@Inject(DB) private readonly db: Database) {
    const pub = process.env.VAPID_PUBLIC_KEY?.trim();
    const priv = process.env.VAPID_PRIVATE_KEY?.trim();
    const subject = process.env.VAPID_SUBJECT?.trim() || 'https://hub.finsera.nl';
    if (pub && priv) {
      webpush.setVapidDetails(subject, pub, priv);
      this.publicKey = pub;
    } else {
      this.publicKey = null;
      this.logger.log('Push is off: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set.');
    }
  }

  get enabled(): boolean {
    return this.publicKey !== null;
  }

  async devices(actor: Actor, currentEndpoint?: string): Promise<DeviceView[]> {
    const rows = await this.db
      .select()
      .from(pushDevices)
      .where(and(eq(pushDevices.personId, actor.userId), isNull(pushDevices.revokedAt)));
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      current: !!currentEndpoint && r.endpoint === currentEndpoint,
    }));
  }

  /** Keep this browser's subscription. Re-subscribing the same endpoint moves it to whoever asks. */
  async register(
    actor: Actor,
    input: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; label?: string },
  ): Promise<{ id: string }> {
    const endpoint = input?.endpoint?.trim();
    const p256dh = input?.keys?.p256dh?.trim();
    const auth = input?.keys?.auth?.trim();
    if (!endpoint || !p256dh || !auth || !/^https:\/\//.test(endpoint)) {
      throw new BadRequestException('A push subscription needs an https endpoint and its keys');
    }
    const label = (input.label ?? 'This device').slice(0, 80);
    const id = uuidv7();
    const [row] = await this.db
      .insert(pushDevices)
      .values({ id, personId: actor.userId, endpoint, p256dh, auth, label })
      .onConflictDoUpdate({
        target: pushDevices.endpoint,
        // One browser profile, one owner: whoever subscribed it last receives its pushes.
        set: { personId: actor.userId, p256dh, auth, label, revokedAt: null, failures: 0 },
      })
      .returning({ id: pushDevices.id });
    return { id: row!.id };
  }

  /** Forget a device — by endpoint on sign-out, by id from the device list. Own devices only. */
  async remove(actor: Actor, by: { id?: string; endpoint?: string }): Promise<{ removed: number }> {
    if (!by.id && !by.endpoint) return { removed: 0 };
    const removed = await this.db
      .update(pushDevices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(pushDevices.personId, actor.userId),
          isNull(pushDevices.revokedAt),
          by.id ? eq(pushDevices.id, by.id) : eq(pushDevices.endpoint, by.endpoint!),
        ),
      )
      .returning({ id: pushDevices.id });
    return { removed: removed.length };
  }

  /** Whether this person has anywhere to push to. */
  async hasDevices(personId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pushDevices)
      .where(and(eq(pushDevices.personId, personId), isNull(pushDevices.revokedAt)));
    return (row?.n ?? 0) > 0;
  }

  /**
   * Send to every device of one person. True if at least one accepted it.
   *
   * A 404 or 410 means the subscription no longer exists — the app was removed, permission
   * revoked — and the device is revoked at once. Anything else counts as a failure, and three in
   * a row give up on the device, so a broken one does not cost a request per notification forever.
   */
  async send(personId: string, payload: PushPayload): Promise<{ delivered: boolean; error?: string }> {
    if (!this.enabled) return { delivered: false, error: 'push not configured' };
    const devices = await this.db
      .select()
      .from(pushDevices)
      .where(and(eq(pushDevices.personId, personId), isNull(pushDevices.revokedAt)));
    if (devices.length === 0) return { delivered: false, error: 'no devices' };

    let delivered = false;
    let lastError: string | undefined;
    const body = JSON.stringify(payload);
    for (const d of devices) {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          body,
          // Twelve hours: a push about a mention is still worth having after a flight, and
          // not after a weekend — the Inbox has it by then.
          { TTL: 12 * 60 * 60, urgency: 'normal', topic: topicOf(payload.tag) },
        );
        delivered = true;
        await this.db
          .update(pushDevices)
          .set({ lastSuccessAt: new Date(), failures: 0 })
          .where(eq(pushDevices.id, d.id));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        lastError = `${status ?? ''} ${(err as Error).message}`.trim();
        const gone = status === 404 || status === 410;
        const failures = d.failures + 1;
        await this.db
          .update(pushDevices)
          .set({
            failures,
            revokedAt: gone || failures >= MAX_FAILURES ? new Date() : null,
          })
          .where(eq(pushDevices.id, d.id));
        if (!gone) this.logger.warn(`Push to ${d.label} failed: ${lastError}`);
      }
    }
    return delivered ? { delivered } : { delivered, error: lastError };
  }
}

/**
 * A push service `Topic` (RFC 8030): at most 32 URL-safe characters. Two pushes with the same
 * topic replace each other while still queued at the relay — the same collapsing the `tag`
 * does once they arrive.
 */
function topicOf(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (Math.imul(31, h) + tag.charCodeAt(i)) | 0;
  return `n${(h >>> 0).toString(36)}`;
}
