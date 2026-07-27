import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InsightsService } from './insights.service.js';

/** Every six hours. Insight conditions change by the day, not the minute. */
const INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A short delay after boot, so startup is not competing with a full rule sweep. */
const FIRST_RUN_DELAY_MS = 30_000;

/**
 * The first background process in this platform that writes.
 *
 * That is worth being careful about, so the guarantees are narrow and explicit:
 *
 * - It only ever writes to `insights.insights`. No domain record is touched, no message
 *   is sent, no status is changed. The worst a bug here can do is show a wrong sentence.
 * - `refresh()` is idempotent, matching on natural keys, so a restart mid-run cannot
 *   duplicate anything and a missed run costs nothing but freshness.
 * - A failure is logged and the timer continues. A rule that breaks must not take the
 *   application down, and must not stop the other rules running tomorrow.
 * - It is disabled entirely under test, where a timer firing mid-assertion is just noise.
 */
@Injectable()
export class InsightsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InsightsScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly insights: InsightsService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || process.env.INSIGHTS_DISABLED === 'true') {
      this.logger.log('Insight scheduler disabled.');
      return;
    }
    this.firstRun = setTimeout(() => void this.run(), FIRST_RUN_DELAY_MS);
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.logger.log(`Insight scheduler started; every ${INTERVAL_MS / 3_600_000}h.`);
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
  }

  /** Public so the controller can offer a manual refresh. */
  async run(): Promise<void> {
    // A slow sweep must not overlap itself; skipping is always safe here because the
    // next run recomputes everything from scratch anyway.
    if (this.running) return;
    this.running = true;
    try {
      const { raised, refreshed, resolved } = await this.insights.refresh();
      if (raised || resolved) {
        this.logger.log(`Insights: ${raised} raised, ${refreshed} refreshed, ${resolved} resolved.`);
      }
    } catch (error) {
      this.logger.error(`Insight refresh failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
