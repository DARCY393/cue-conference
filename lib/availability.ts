import type { BookableHours, BusyInterval } from "./types";

export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  // Half-open [start, end)
  return aStart < bEnd && bStart < aEnd;
}

/** Convert instant to local parts in a given IANA timezone. */
export function zonedParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  let hour = parseInt(parts.hour, 10);
  // Some engines emit 24 for midnight
  if (hour === 24) hour = 0;
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    weekday: weekdayMap[parts.weekday] ?? 0,
  };
}

/** Offset (local minus UTC, in minutes) of an IANA timeZone at a given instant. */
function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  });
  const tzName =
    fmt.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(tzName);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}

/** Convert a local wall-clock date/time in an IANA timezone to the equivalent UTC instant. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  // Converge in at most two steps — handles the DST-transition edge case where
  // the offset at the first guess differs from the offset actually in effect.
  for (let i = 0; i < 2; i++) {
    const offsetMinutes = timeZoneOffsetMinutes(utcGuess, timeZone);
    const next = new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60 * 1000);
    if (next.getTime() === utcGuess.getTime()) break;
    utcGuess = next;
  }
  return utcGuess;
}

export interface DayWindow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Multi-day bookings: a guest picks one daily start/end time plus an optional
 * end calendar date (default = start date). We charge and reserve each
 * bookable weekday in that range independently rather than treating the
 * whole span as one continuous block — a Fri-start/Mon-end booking should
 * charge for Fri and Mon only, not for the Saturday/Sunday gap, and must not
 * be blocked by something else happening during that gap.
 *
 * `startsAt`/`endsAt` supply the daily start/end time-of-day (their calendar
 * date is only used for the first day when `endDate` is omitted). `endDate`
 * supplies the calendar date of the last day (any instant on that local day).
 * Days whose weekday has no bookable-hours window covering the requested
 * daily time range are skipped (not charged, not reserved) rather than
 * rejected outright — the caller decides what an empty result means.
 */
export function expandDayWindows(
  startsAt: Date,
  endsAt: Date,
  endDate: Date | null,
  timeZone: string,
  bookableHours: BookableHours[]
): DayWindow[] {
  const start = zonedParts(startsAt, timeZone);
  const end = zonedParts(endsAt, timeZone);
  const dailyStartMinute = start.hour * 60 + start.minute;
  const dailyEndMinute = end.hour * 60 + end.minute;
  const last = endDate ? zonedParts(endDate, timeZone) : start;

  const windows: DayWindow[] = [];
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  const lastCursor = Date.UTC(last.year, last.month - 1, last.day);
  while (cursor <= lastCursor) {
    const d = new Date(cursor);
    const weekday = d.getUTCDay();
    const bookable = bookableHours.some(
      (h) =>
        h.weekday === weekday &&
        dailyStartMinute >= h.startMinute &&
        dailyEndMinute <= h.endMinute
    );
    if (bookable && dailyEndMinute > dailyStartMinute) {
      const y = d.getUTCFullYear();
      const mo = d.getUTCMonth() + 1;
      const da = d.getUTCDate();
      windows.push({
        startsAt: zonedTimeToUtc(y, mo, da, Math.floor(dailyStartMinute / 60), dailyStartMinute % 60, timeZone),
        endsAt: zonedTimeToUtc(y, mo, da, Math.floor(dailyEndMinute / 60), dailyEndMinute % 60, timeZone),
      });
    }
    cursor += 24 * 60 * 60 * 1000;
  }
  return windows;
}

/** Sum of each window's (end - start) in hours — the reservation's total billable hours. */
export function totalWindowHours(windows: DayWindow[]): number {
  return windows.reduce(
    (sum, w) => sum + (w.endsAt.getTime() - w.startsAt.getTime()) / (1000 * 60 * 60),
    0
  );
}

export function isAvailable(
  startsAt: Date,
  endsAt: Date,
  busy: BusyInterval[],
  excludeBookingId?: string
): boolean {
  for (const b of busy) {
    if (excludeBookingId && (b as BusyInterval & { id?: string }).id === excludeBookingId) {
      continue;
    }
    if (
      rangesOverlap(
        startsAt,
        endsAt,
        new Date(b.startsAt),
        new Date(b.endsAt)
      )
    ) {
      return false;
    }
  }
  return true;
}

export function filterBusyInRange(
  busy: BusyInterval[],
  from: Date,
  to: Date
): BusyInterval[] {
  return busy.filter((b) =>
    rangesOverlap(from, to, new Date(b.startsAt), new Date(b.endsAt))
  );
}
