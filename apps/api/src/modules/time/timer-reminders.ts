import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../../core/db/db.module.js';
import { NotificationService } from '../../core/notifications/notification.service.js';
import {
  localClock,
  minutesOf,
  withinWorkingHours,
} from '../../core/notifications/working-hours.js';

const TICK_MS = 5 * 60_000;
/** The end-of-day reminder comes this long before the day ends, so it lands inside it. */
const BEFORE_END_MIN = 15;

interface Running {
  id: string;
  personId: string;
  startedAt: Date;
  projectName: string | null;
}

/**
 * Reminders about a clock that is still running (docs/notifications-brief.md §4.3).
 *
 * Its own job, every five minutes, because it is about a clock rather than an event — and the
 * Insights sweep, every six hours, is far too coarse to say "three hours" on time. Three
 * reminders, each sent once per running entry, each switchable in settings:
 *
 * - **after N hours** (default 3), during working hours;
 * - **near the end of the working day**, if it is still going;
 * - **the morning after**, if it ran overnight — where the Time page asks for the hours
 *   actually worked, which is the job a clock left on overnight really needs.
 *
 * Nothing at night: the overnight case is answered in the morning by design (brief N7).
 * Stopping the clock clears whatever was said about it.
 *
 * The reminders carry no subject: a time entry is readable type-wide only by whoever may read
 * everyone's hours, so they link to the Time page, which knows the entry is yours.
 */
@Injectable()
export class TimerReminders implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TimerReminders.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || process.env.NOTIFICATIONS_DISABLED) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const running = await this.runningEntries();
      for (const entry of running) await this.remind(entry, now);
      await this.clearStopped(new Set(running.map((r) => r.id)));
    } catch (err) {
      this.logger.error(`Timer reminders failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async runningEntries(): Promise<Running[]> {
    const { rows } = await this.db.execute(sql`
      SELECT e.id, e.person_id, e.started_at, p.name AS project_name
        FROM time.v_entries e
        LEFT JOIN crm.v_projects p ON p.id = e.project_id
       WHERE e.running
    `);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      personId: String(r.person_id),
      startedAt: new Date(String(r.started_at)),
      projectName: r.project_name == null ? null : String(r.project_name),
    }));
  }

  async remind(entry: Running, now: Date): Promise<void> {
    const settings = await this.notifications.settings(entry.personId);
    if (!settings.timer.enabled) return;
    // Every reminder is for working hours; outside them there is nothing to say until morning.
    if (!withinWorkingHours(settings, now)) return;

    const hours = (now.getTime() - entry.startedAt.getTime()) / 3_600_000;
    const on = entry.projectName ? `on ${entry.projectName}` : 'on internal work';
    const today = localClock(settings, now);
    const started = localClock(settings, entry.startedAt);
    const base = {
      personId: entry.personId,
      category: 'time',
      tier: 'now' as const,
      groupKey: `timer:${entry.id}`,
      url: '/time',
    };

    if (settings.timer.overnight && started.date < today.date) {
      await this.notifications.notify({
        ...base,
        title: `Your clock ${on} ran overnight (${Math.floor(hours)}h). Set the hours you actually worked.`,
        dedupeKey: `timer.overnight:${entry.id}`,
      });
      return; // the morning-after message says it all; the others would repeat it
    }

    const end = minutesOf(settings.workEnd);
    if (settings.timer.endOfDay && today.minutes >= end - BEFORE_END_MIN && today.minutes < end) {
      await this.notifications.notify({
        ...base,
        title: `Your clock ${on} is still running as the day ends`,
        dedupeKey: `timer.eod:${entry.id}:${today.date}`,
      });
      return;
    }

    const after = settings.timer.afterHours;
    if (after > 0 && hours >= after) {
      await this.notifications.notify({
        ...base,
        title: `Your clock ${on} has been running for ${Math.floor(hours)}h`,
        dedupeKey: `timer.long:${entry.id}`,
      });
    }
  }

  /** A clock that stopped takes its reminders with it — they are about nothing now. */
  private async clearStopped(runningIds: Set<string>): Promise<void> {
    for (const g of await this.notifications.openGroups('timer:')) {
      const id = g.groupKey.slice('timer:'.length);
      if (!runningIds.has(id)) await this.notifications.clear({ groupKey: g.groupKey, personId: g.personId });
    }
  }
}
