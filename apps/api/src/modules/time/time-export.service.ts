import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { DB, type Database } from '../../core/db/db.module.js';
import { UserService } from '../../core/auth/user.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { DocumentStore, refFromRow } from '../../core/storage/document-store.js';
import { entries, exports_ } from './time.schema.js';
import { csvHours, csvYesNo, toCsv } from './csv.js';

/**
 * How long the first change of a burst waits for company before the month is written.
 *
 * A trailing debounce, not a poll: nothing is scheduled while nobody is logging hours, and
 * a Friday afternoon of entering the week produces one write rather than one per entry.
 * Zero means write as soon as the current call finishes.
 */
const DEFAULT_DEBOUNCE_MINUTES = 5;

const HEADER = [
  'datum',
  'persoon',
  'klant',
  'project',
  'taak',
  'uren',
  'minuten',
  'declarabel',
  'omschrijving',
  'gefactureerd',
  'regel-id',
];

/**
 * The monthly hours ledger, in SharePoint.
 *
 * Not a backup — the database is the record and pg_dump is the backup. This is the portable
 * copy: readable on a phone at month end without the platform being up, readable in seven
 * years without a Postgres to restore it into, and — because SharePoint versions every write
 * — a trail of what the month looked like while it was being filled in.
 *
 * That trail is the part worth being careful about. A naive exporter that writes on a timer
 * produces ninety-six identical versions on a quiet day, blows through the library's version
 * cap in weeks, and leaves a history nobody can read. So a write only happens when the CSV
 * actually differs from what was last written, and the checksum that decides it is the whole
 * reason the exports table exists.
 *
 * The other half is the cadence. Writing on every entry would mean one SharePoint version per
 * logged hour — the same problem from the other direction, plus an app-only throttle. So
 * mutations mark the month dirty and a timer flushes, which is the same debounce the note
 * editor uses for ProseMirror steps.
 *
 * Nothing here may ever fail a time entry. Somebody logging hours is not doing so on the
 * condition that Microsoft is reachable.
 */
@Injectable()
export class TimeExportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TimeExportService.name);

  /** Months with unexported changes, as 'YYYY-MM'. */
  private readonly dirty = new Set<string>();
  /** The armed debounce, or null when nothing is pending. */
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly users: UserService,
    private readonly store: DocumentStore,
  ) {}

  /**
   * Nothing is scheduled at boot, with one exception.
   *
   * The dirty set lives in memory, so a change made just before a restart would otherwise
   * wait for the next unrelated change to be noticed. Arming the current and previous month
   * once closes that gap for the cost of two CSV builds — and because a write only happens
   * when the content differs from the stored checksum, the usual outcome is no write at all.
   */
  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Hours export: off (documents are not in SharePoint)');
      return;
    }
    this.logger.log(
      `Hours export: on the first change, coalesced for ${this.debounceMinutes} min`,
    );

    const now = new Date();
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    this.dirty.add(now.toISOString().slice(0, 7));
    this.dirty.add(previous.toISOString().slice(0, 7));
    this.arm();
  }

  /**
   * A stop writes what is pending rather than dropping it.
   *
   * The dirty set is in memory, so without this a deploy in the middle of somebody's
   * debounce window would silently discard their afternoon from the ledger — and nothing
   * afterwards would know to go looking, because the next flush only writes months it has
   * been told about.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.dirty.size === 0) return;
    await this.flush().catch((e) =>
      this.logger.warn(`Hours export on shutdown failed: ${(e as Error).message}`),
    );
  }

  /**
   * Start the clock, or leave the running one alone.
   *
   * Leaving it alone is the coalescing: the window belongs to the first change of a burst,
   * so a hundred entries in five minutes share one write rather than each pushing the
   * deadline further out and starving the ledger while somebody keeps typing.
   */
  private arm(): void {
    if (this.timer || !this.enabled) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().then(() => {
        // Anything that arrived during the flush, or a month that failed and went back in.
        if (this.dirty.size > 0) this.arm();
      });
    }, this.debounceMinutes * 60_000);
    // Never hold the process open: a CLI or a test that has finished should exit.
    this.timer.unref?.();
  }

  /**
   * Only when documents actually live in SharePoint.
   *
   * Exporting to the local disk would write a CSV next to the document blobs that nothing
   * reads and no backup treats differently from the database it was copied out of — all of
   * the cost and none of the point.
   */
  private get enabled(): boolean {
    return this.store.backend === 'sharepoint' && this.store.available;
  }

  /** Zero is meaningful here — it means "write as soon as this call returns". */
  private get debounceMinutes(): number {
    const raw = Number(process.env.TIME_EXPORT_DEBOUNCE_MINUTES);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DEBOUNCE_MINUTES;
  }

  /**
   * Something happened to this day's hours.
   *
   * Called on create, update and delete — deletions especially, because a deleted entry is
   * the one change that leaves nothing behind in the database to notice later.
   */
  markDirty(workedOn: string | Date | null | undefined): void {
    if (!this.enabled || !workedOn) return;
    const iso = typeof workedOn === 'string' ? workedOn : workedOn.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}/.test(iso)) return;
    this.dirty.add(iso.slice(0, 7));
    this.arm();
  }

  /**
   * Write every dirty month whose content has actually changed.
   *
   * Months are taken out of the set before the work starts, so an entry logged during a slow
   * upload marks the month dirty again rather than being swallowed by the flush that was
   * already in flight.
   */
  async flush(): Promise<{ written: string[]; unchanged: string[] }> {
    if (!this.enabled || this.running) return { written: [], unchanged: [] };
    this.running = true;

    const months = [...this.dirty];
    this.dirty.clear();
    const written: string[] = [];
    const unchanged: string[] = [];

    try {
      for (const month of months) {
        try {
          if (await this.exportMonth(month)) written.push(month);
          else unchanged.push(month);
        } catch (e) {
          // Put it back: a tenant outage should delay the ledger, not silently skip a month.
          this.dirty.add(month);
          const message = (e as Error).message;
          await this.db
            .insert(exports_)
            .values({ month, lastError: message })
            .onConflictDoUpdate({ target: exports_.month, set: { lastError: message } });
          this.logger.warn(`Hours export for ${month} failed: ${message}`);
        }
      }
    } finally {
      this.running = false;
    }

    return { written, unchanged };
  }

  /** True when something was written; false when the month was already up to date. */
  private async exportMonth(month: string): Promise<boolean> {
    const csv = await this.buildCsv(month);
    const checksum = createHash('sha256').update(csv.body).digest('hex');

    const [previous] = await this.db
      .select()
      .from(exports_)
      .where(eq(exports_.month, month))
      .limit(1);

    // The check that keeps the version history worth having.
    if (previous?.checksum === checksum && previous.driveItemId) return false;

    /*
     * A month with nothing logged yet gets no file.
     *
     * Only when there is nothing to say AND nothing has ever been said: once a month has a
     * file, emptying it is itself news — hours that were there and are not any more is
     * precisely what somebody would come to this ledger to find out.
     */
    if (csv.rows === 0 && !previous?.driveItemId) return false;

    const filename = `uren-${month}.csv`;
    const data = Buffer.from(csv.body, 'utf8');
    const folder = { bucket: 'exports' as const };

    const result =
      previous?.driveItemId && previous.driveId
        ? await this.store.putNewVersion(
            refFromRow({
              storageBackend: 'sharepoint',
              driveId: previous.driveId,
              driveItemId: previous.driveItemId,
            }),
            { data, filename, folder },
          )
        : await this.store.put({ data, filename, folder });

    const ref = result.ref;
    await this.db
      .insert(exports_)
      .values({
        month,
        driveId: ref.backend === 'sharepoint' ? ref.driveId : null,
        driveItemId: ref.backend === 'sharepoint' ? ref.itemId : null,
        filename: result.filename,
        checksum,
        rowCount: csv.rows,
        exportedAt: new Date(),
        lastError: null,
      })
      .onConflictDoUpdate({
        target: exports_.month,
        set: {
          driveId: ref.backend === 'sharepoint' ? ref.driveId : null,
          driveItemId: ref.backend === 'sharepoint' ? ref.itemId : null,
          filename: result.filename,
          checksum,
          rowCount: csv.rows,
          exportedAt: new Date(),
          lastError: null,
        },
      });

    this.logger.log(`Hours export: ${month} — ${csv.rows} row(s)`);
    return true;
  }

  /**
   * One month of hours, in the shape a spreadsheet opens correctly.
   *
   * Names rather than ids wherever a person would read them, because the point of this file
   * is that it can be understood without the platform that produced it. Ids are kept in the
   * last column so a row can still be traced back.
   *
   * Running timers are excluded: an entry with no minutes is not yet an hour worked, and
   * exporting it would put a row in the ledger that changes value every time it is read.
   */
  private async buildCsv(month: string): Promise<{ body: string; rows: number }> {
    const from = `${month}-01`;
    const to = nextMonth(month);

    const rows = await this.db
      .select()
      .from(entries)
      .where(and(gte(entries.workedOn, from), lt(entries.workedOn, to)))
      .orderBy(entries.workedOn, entries.personId);

    const logged = rows.filter((r) => r.minutes != null);
    const names = await this.nameLookup(logged);
    const clientOf = await this.clientNames(logged);
    // People are not registry entities — the registry holds what modules own, and a
    // colleague is not a document. Their names come from core's user service.
    const personOf = await this.users.namesByIds([
      ...new Set(logged.map((r) => r.personId).filter((id): id is string => !!id)),
    ]);

    const body = toCsv(
      HEADER,
      logged.map((r) => [
        r.workedOn,
        personOf.get(r.personId) ?? r.personId,
        // Client-direct hours name their client; project hours inherit it from the project.
        r.clientId ? (names.get(r.clientId) ?? r.clientId) : (clientOf.get(r.projectId ?? '') ?? ''),
        r.projectId ? (names.get(r.projectId) ?? r.projectId) : '',
        r.taskId ? (names.get(r.taskId) ?? r.taskId) : '',
        csvHours(r.minutes ?? 0),
        r.minutes ?? 0,
        csvYesNo(r.billable),
        r.description ?? '',
        csvYesNo(Boolean(r.invoicedAt)),
        r.id,
      ]),
    );

    return { body, rows: logged.length };
  }

  /**
   * Which client each project belongs to.
   *
   * Read from `crm.v_projects` — CRM's PUBLISHED view, not its tables. That distinction is
   * the whole of the ground rule: a module may not reach into another's schema, and a
   * reporting view is the interface it publishes instead. Without this the ledger would name
   * the project but not the client, which for an hours record is the wrong way round.
   *
   * Internal projects are absent from the view by design, and fall through to a blank cell.
   */
  private async clientNames(
    rows: Array<{ projectId: string | null }>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.projectId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();

    // Bound parameters, not interpolation. These ids come from our own uuid columns, but a
    // query that would be injectable if the source ever changed is a query written wrong.
    const list = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    const { rows: found } = await this.db.execute(
      sql`SELECT id, client_name FROM crm.v_projects WHERE id IN (${list})`,
    );
    return new Map(
      (found as Array<{ id: string; client_name: string }>).map((r) => [r.id, r.client_name]),
    );
  }

  /**
   * Display names for every id in the month, in one query.
   *
   * Through the entity registry rather than by joining CRM's or SCRUM's tables: Time may not
   * read another module's schema, and the registry is exactly what that rule leaves in its
   * place. It also means a deleted project still resolves to the name it had, which is what a
   * ledger of past months needs.
   */
  private async nameLookup(rows: Array<Record<string, unknown>>): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const r of rows) {
      for (const key of ['clientId', 'projectId', 'taskId']) {
        const value = r[key];
        if (typeof value === 'string') ids.add(value);
      }
    }
    if (ids.size === 0) return new Map();

    const refs = await this.registry.resolve([...ids]);
    return new Map(refs.map((r) => [r.id, r.displayName]));
  }
}

/** The first day of the month after this one, as an ISO date. */
function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * An exporter that is permanently off.
 *
 * Most specs construct TimeService by hand and have nothing to do with the hours ledger —
 * they need an object, not a behaviour. Handing them a real exporter would mean wiring a
 * document store into fourteen files to obtain a method that returns immediately anyway.
 */
export const NO_EXPORT = {
  markDirty: () => {},
} as unknown as TimeExportService;
