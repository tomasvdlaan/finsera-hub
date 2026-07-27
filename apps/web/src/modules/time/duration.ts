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
