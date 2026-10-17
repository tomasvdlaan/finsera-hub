import type { NotificationSettings } from '@platform/contracts';

/** The clock and weekday at an instant in a time zone — `Intl`, so DST is the zone's problem. */
function localParts(at: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Whether `at` falls inside this person's working hours. */
export function withinWorkingHours(settings: NotificationSettings, at: Date): boolean {
  const zone = safeZone(settings.timeZone);
  const { day, minutes } = localParts(at, zone);
  return (
    settings.workDays.includes(day) &&
    minutes >= toMinutes(settings.workStart) &&
    minutes < toMinutes(settings.workEnd)
  );
}

/**
 * The first instant at or after `from` that is inside working hours.
 *
 * Found by stepping forward a minute at a time to the next change, rather than by date
 * arithmetic, because the arithmetic is where DST and "no work days at all" bite. A person
 * with no working days set gets `null` — there is no next window, and a held push waits for
 * them to say when they work.
 */
export function nextWorkingStart(settings: NotificationSettings, from: Date): Date | null {
  if (settings.workDays.length === 0 || toMinutes(settings.workStart) >= toMinutes(settings.workEnd)) {
    return null;
  }
  if (withinWorkingHours(settings, from)) return from;
  // Coarse then fine: 15-minute steps to the first inside instant, then back to its minute.
  const step = 15 * 60_000;
  let t = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 8 * 24 * 4; i++) {
    const next = new Date(t.getTime() + step);
    if (withinWorkingHours(settings, next)) {
      let exact = new Date(next.getTime() - step);
      while (!withinWorkingHours(settings, exact)) exact = new Date(exact.getTime() + 60_000);
      return exact;
    }
    t = next;
  }
  return null;
}

/** An unknown zone falls back to the default rather than throwing inside a delivery. */
function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return 'Europe/Amsterdam';
  }
}
