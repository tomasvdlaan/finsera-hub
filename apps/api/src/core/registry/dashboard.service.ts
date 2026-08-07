import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { dashboards } from '../db/core.schema.js';
import type { Actor } from '../auth/auth.types.js';

/** One widget on a dashboard. `id` is the placement, not the widget — see the comment below. */
export interface Placement {
  id: string;
  widget: string;
  span: number;
  settings?: Record<string, string>;
}

/** The only widths a placement may claim, matching the twelve-column page grid. */
const SPANS = new Set([3, 4, 6, 8, 9, 12]);

/**
 * More than this and the page is a list, not a dashboard.
 *
 * A soft-ish limit that exists mostly as a backstop: a layout is user-supplied jsonb, and
 * without a bound a bad client could store a megabyte of placements that every page load then
 * has to fetch and render.
 */
const MAX_PLACEMENTS = 40;

/**
 * What everybody starts with.
 *
 * Not an empty page. A dashboard you have to build before it shows you anything is a dashboard
 * most people never build — the first-run experience would be a blank screen and a button,
 * which reads as a page that failed to load rather than as an invitation.
 *
 * This is roughly what /today showed before it became configurable, which makes the change
 * invisible to somebody who does not want to configure anything. That is the point: the
 * feature is for the people who do.
 *
 * Widget keys are not validated against the frontend registry here, because the server has no
 * way to see it. A key that no longer resolves is dropped at render — see resolve() on the web
 * side, and the reasoning there for why dropping beats erroring.
 */
export const STARTER_LAYOUT: Placement[] = [
  { id: 'w1', widget: 'scrum:in-progress', span: 3 },
  { id: 'w2', widget: 'scrum:waiting-on-client', span: 3 },
  { id: 'w3', widget: 'scrum:overdue', span: 3 },
  { id: 'w4', widget: 'time:logged-today', span: 3 },
  { id: 'w5', widget: 'insights:needs-you', span: 8 },
  { id: 'w6', widget: 'time:fortnight', span: 4 },
  { id: 'w7', widget: 'scrum:doing', span: 6 },
  { id: 'w8', widget: 'scrum:waiting-list', span: 6 },
];

@Injectable()
export class DashboardService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * This person's layout, or the starter one.
   *
   * A missing row is not an error and is not written on read: seeding on first GET would mean
   * every person who has never opened the dashboard gets a row the moment something warms a
   * cache, and it would freeze the starter layout at whatever it was on that day. Somebody who
   * has never customised anything should keep getting the current default as it improves.
   */
  async get(actor: Actor): Promise<{ layout: Placement[]; custom: boolean }> {
    const userId = this.requireUser(actor);
    const [row] = await this.db
      .select({ layout: dashboards.layout })
      .from(dashboards)
      .where(eq(dashboards.userId, userId));
    if (!row) return { layout: STARTER_LAYOUT, custom: false };
    return { layout: row.layout as Placement[], custom: true };
  }

  /** Replace this person's layout wholesale. There is no partial update; a drag rewrites it. */
  async save(actor: Actor, layout: unknown): Promise<{ layout: Placement[] }> {
    const userId = this.requireUser(actor);
    const clean = this.validate(layout);
    await this.db
      .insert(dashboards)
      .values({ userId, layout: clean, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: dashboards.userId,
        set: { layout: clean, updatedAt: new Date() },
      });
    return { layout: clean };
  }

  /** Back to the starter layout, by deleting the row rather than by writing the default into it. */
  async reset(actor: Actor): Promise<{ layout: Placement[] }> {
    const userId = this.requireUser(actor);
    await this.db.delete(dashboards).where(eq(dashboards.userId, userId));
    return { layout: STARTER_LAYOUT };
  }

  /**
   * A dashboard belongs to a person, so there has to be one.
   *
   * Machine actors — the scheduler, the event worker — have no user id and no dashboard. This
   * is the honest failure rather than silently reading somebody else's.
   */
  private requireUser(actor: Actor): string {
    if (!actor.userId) throw new BadRequestException('A dashboard belongs to a person, and this caller is not one');
    return actor.userId;
  }

  /**
   * What may be stored.
   *
   * Deliberately structural only: shape, types, spans, size and unique placement ids. Whether
   * `scrum:doing` is a real widget is not checkable here — that set lives in the frontend
   * registry and changes when a module ships — and pretending otherwise would mean this file
   * needs editing every time somebody adds a card.
   *
   * Settings are string-to-string and are not interpreted. A widget's settings are its own
   * business, and a server that validated them would have to know every widget's schema, which
   * is the same coupling in a different place.
   */
  private validate(input: unknown): Placement[] {
    if (!Array.isArray(input)) throw new BadRequestException('A layout is a list of widgets');
    if (input.length > MAX_PLACEMENTS) {
      throw new BadRequestException(`A dashboard holds at most ${MAX_PLACEMENTS} widgets`);
    }

    const seen = new Set<string>();
    return input.map((raw, i) => {
      const p = raw as Partial<Placement>;
      if (typeof p.id !== 'string' || p.id.length === 0 || p.id.length > 64) {
        throw new BadRequestException(`Widget ${i + 1} has no usable id`);
      }
      if (seen.has(p.id)) throw new BadRequestException(`Two widgets share the id '${p.id}'`);
      seen.add(p.id);

      if (typeof p.widget !== 'string' || !/^[a-z-]+:[a-z0-9-]+$/.test(p.widget)) {
        throw new BadRequestException(`'${String(p.widget)}' is not a widget name`);
      }
      if (typeof p.span !== 'number' || !SPANS.has(p.span)) {
        throw new BadRequestException(`A widget cannot be ${String(p.span)} columns wide`);
      }

      const settings: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.settings ?? {})) {
        if (typeof v !== 'string' || v.length > 128) {
          throw new BadRequestException(`Setting '${k}' on widget ${i + 1} is not a short string`);
        }
        settings[k] = v;
      }

      return { id: p.id, widget: p.widget, span: p.span, settings };
    });
  }
}
