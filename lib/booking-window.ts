/**
 * Booking-window rules shared by the room page (client) and the API (server).
 * Pure, browser-safe: no Node imports.
 *
 * - Every wall-clock date/time a guest picks is America/Chicago (the room's
 *   timezone), never the browser's own timezone.
 * - A booking can't start in the past: today's start times that have already
 *   passed (in the room's timezone) are not offered, and the server rejects
 *   them in quote, draft and authorize.
 */
import { zonedParts, zonedTimeToUtc } from "./availability";

export const ROOM_TIMEZONE = "America/Chicago";

export const START_IN_PAST_MESSAGE =
  "That start time has already passed. Please pick a later time.";

/** yyyy-mm-dd of `now` in `timeZone`. */
export function localDateString(now: Date, timeZone: string = ROOM_TIMEZONE): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes since local midnight of `now` in `timeZone`. */
export function localMinutesOfDay(now: Date, timeZone: string = ROOM_TIMEZONE): number {
  const p = zonedParts(now, timeZone);
  return p.hour * 60 + p.minute;
}

/** The UTC instant for a yyyy-mm-dd date and HH:MM wall-clock time in `timeZone`. */
export function wallClockToUtc(date: string, hhmm: string, timeZone: string = ROOM_TIMEZONE): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(y, mo, d, h || 0, mi || 0, timeZone);
}

/** True when `startsAt` is at or before `now` (a booking must start in the future). */
export function isStartInPast(startsAt: Date, now: Date = new Date()): boolean {
  return startsAt.getTime() <= now.getTime();
}

/**
 * Start-time options (HH:MM) still bookable on `date`: all of them on a future
 * date, only those strictly after the current local time when `date` is today,
 * and none when `date` is already past.
 */
export function futureStartTimes(
  options: string[],
  date: string,
  now: Date = new Date(),
  timeZone: string = ROOM_TIMEZONE
): string[] {
  const today = localDateString(now, timeZone);
  if (date > today) return options;
  if (date < today) return [];
  const nowMin = localMinutesOfDay(now, timeZone);
  return options.filter((t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m > nowMin;
  });
}

/**
 * The first weekday (Mon–Fri), on or after today in `timeZone`, that still has
 * at least one start time in `startOptions` in the future. Returns yyyy-mm-dd.
 */
export function firstBookableDate(
  startOptions: string[],
  now: Date = new Date(),
  timeZone: string = ROOM_TIMEZONE
): string {
  const p = zonedParts(now, timeZone);
  let cursor = Date.UTC(p.year, p.month - 1, p.day);
  for (let i = 0; i < 14; i++) {
    const d = new Date(cursor);
    const weekday = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (weekday >= 1 && weekday <= 5 && futureStartTimes(startOptions, iso, now, timeZone).length > 0) {
      return iso;
    }
    cursor += 24 * 60 * 60 * 1000;
  }
  return localDateString(now, timeZone);
}

export const ACCEPT_START_PASSED_MESSAGE =
  "This request's start time has already passed, so it can't be accepted. Decline it to release the card hold.";

/**
 * Staff may accept a request only while its start time is still in the future
 * (America/Chicago). Decline stays available so the hold can be released.
 */
export function isAcceptable(
  booking: { status: string; startsAt: string },
  now: Date = new Date()
): boolean {
  return booking.status === "requested" && !isStartInPast(new Date(booking.startsAt), now);
}
