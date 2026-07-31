/**
 * Duration parsing and formatting.
 *
 * Minutes are the stored unit (exact, invoice-safe). Humans type "7,5", "7.5", "7:30",
 * "90m" or "1h30" — accepting all of them is part of the under-a-minute goal, because
 * being told your input is wrong is slower than any keystroke saved.
 */
export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase().replace(',', '.');
  if (!raw) return 0;

  // 7:30 → 450
  const clock = raw.match(/^(\d+):([0-5]?\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);

  // 1h30 / 1h / 90m
  const compound = raw.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m?)?$/);
  if (compound && (compound[1] || compound[2]) && raw.includes('h')) {
    const hours = compound[1] ? Number(compound[1]) : 0;
    const mins = compound[2] ? Number(compound[2]) : 0;
    return Math.round(hours * 60 + mins);
  }
  if (/^\d+m$/.test(raw)) return Number(raw.slice(0, -1));

  // Bare number = hours (7.5 → 450), the most common case.
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return null;
  return Math.round(hours * 60);
}

/**
 * 450 → "7.5". Trailing zeros dropped so a full day reads "8", not "8.00".
 * Zero renders empty — grid cells should look blank, not littered with noughts.
 */
export function formatDuration(minutes: number): string {
  if (!minutes) return '';
  return formatHours(minutes);
}

/** Like formatDuration but always renders a number — for totals and prose, where an
 *  empty string would produce "h billable of h logged". */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, '');
}

/**
 * How long something took, for a human reading it rather than an invoice.
 *
 * `formatHours` gives decimal hours — 1.5, 0.25 — which is the right unit next to a rate and
 * on the week grid, because that is what gets multiplied by money. It is the wrong unit on a
 * tracker: nobody says they spent nought point two five of an hour on something. Both exist
 * on purpose, and which one a screen uses says what that screen is for.
 *
 * Zero renders as `0m` rather than as nothing. A total that disappears when it is zero reads
 * as a page that failed to load.
 */
export function formatSpan(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shiftWeek(weekOf: string, weeks: number): string {
  const d = new Date(`${weekOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export function formatDayHeader(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

export const isToday = (iso: string) => iso === new Date().toISOString().slice(0, 10);
export const isWeekend = (index: number) => index >= 5;

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO timestamp → "09:30" in the viewer's local time. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** ISO timestamp → "09:30" for an <input type="time"> (local, 24h, zero-padded). */
export function toClockValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Turn a date plus two clock times into unambiguous timestamps.
 *
 * A shift can cross midnight — 22:00 to 02:00 is four hours, not a negative one. When
 * the end clock is at or before the start clock, it belongs to the following day. The
 * API takes explicit timestamps, so this inference lives here, where the ambiguity is:
 * the clock times are what the user typed, the dates are what they meant.
 */
export function resolveTimes(
  date: string,
  start: string,
  end: string,
): { startedAt: string | null; endedAt: string | null; crossesMidnight: boolean } {
  if (!start) return { startedAt: null, endedAt: end ? `${date}T${end}:00` : null, crossesMidnight: false };

  const startedAt = `${date}T${start}:00`;
  if (!end) return { startedAt, endedAt: null, crossesMidnight: false };

  const crossesMidnight = end <= start; // string compare is safe for zero-padded HH:MM
  const endDate = crossesMidnight ? shiftDay(date, 1) : date;
  return { startedAt, endedAt: `${endDate}T${end}:00`, crossesMidnight };
}

/** True when an entry's end falls on a later day than its start. */
export function spansMidnight(startedAt: string | null, endedAt: string | null): boolean {
  if (!startedAt || !endedAt) return false;
  return new Date(startedAt).toDateString() !== new Date(endedAt).toDateString();
}
