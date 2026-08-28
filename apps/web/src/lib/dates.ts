/**
 * Calendar arithmetic, in the local zone.
 *
 * `modules/time/duration.ts` already has date helpers, and this is deliberately not importing
 * them: the shell does not reach into a module, and these answer a different question anyway.
 * That file is about durations — how long something took, how to print it. This one is about
 * where a moment sits in a week, which is the only question a calendar grid asks.
 *
 * Everything here works in **local** time and passes dates around as `YYYY-MM-DD` strings.
 * That is not a shortcut: a calendar is a local-time object. Tuesday is Tuesday where the
 * person is sitting, and the moment you route a day boundary through UTC you get an agenda
 * that is correct in Greenwich and off by one either side of it.
 */

/** A local `YYYY-MM-DD`. `toISOString()` is UTC and would name the wrong day either side of it. */
export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayIso = (): string => toIsoDate(new Date());

/** Local midnight opening the given day. */
export function startOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/**
 * Date arithmetic through the Date object rather than through milliseconds.
 *
 * `+ 86_400_000` is the tempting version and it is wrong twice a year: on the days a clock
 * changes, adding twenty-four hours to a midnight lands at 23:00 or 01:00 of the next day
 * rather than on its midnight. `setDate` moves the calendar day and lets the runtime work out
 * what that means in hours, which is exactly the distinction this file exists to keep.
 */
export function shiftDay(iso: string, days: number): string {
  const d = startOfDay(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** The local day an instant falls on. */
export function isoDateOf(instant: string | Date): string {
  return toIsoDate(typeof instant === 'string' ? new Date(instant) : instant);
}

/**
 * How long a day actually is, in minutes.
 *
 * 1440 on all but two days a year. Measured from one local midnight to the next rather than
 * assumed, because the whole point of drawing an hour grid is that a block lands on the hour
 * it says — and on the day the clocks go back, a grid built on 1440 puts everything after
 * 03:00 an hour out of place.
 */
export function dayLengthMinutes(iso: string): number {
  return Math.round((startOfDay(shiftDay(iso, 1)).getTime() - startOfDay(iso).getTime()) / 60_000);
}

/**
 * Where an instant sits inside a given day, as a fraction from 0 to 1.
 *
 * Outside 0..1 when the instant is not on that day, which is deliberate and load-bearing: a
 * meeting running from 23:00 to 00:30 is clamped by the caller against the column it is being
 * drawn in, and a function that clamped here could not tell the caller which end overflowed.
 */
export function dayFraction(instant: string | Date, iso: string): number {
  const t = (typeof instant === 'string' ? new Date(instant) : instant).getTime();
  return (t - startOfDay(iso).getTime()) / (dayLengthMinutes(iso) * 60_000);
}

/** Monday of the week containing `iso` — the week the timesheet already counts in. */
export function weekStart(iso: string): string {
  return shiftDay(iso, -((startOfDay(iso).getDay() + 6) % 7));
}

export function weekDays(weekOf: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(weekOf, i));
}

/** Whole days from `from` to `to`, signed. Calendar days, not elapsed hours — see shiftDay. */
export function daysBetween(from: string, to: string): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Inclusive on both ends, which is how every date range a person types means it. */
export function isWithin(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function clock(instant: string | Date): string {
  return CLOCK.format(typeof instant === 'string' ? new Date(instant) : instant);
}
