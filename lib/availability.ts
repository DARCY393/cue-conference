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

export function withinBookableHours(
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
  bookableHours: BookableHours[]
): boolean {
  if (endsAt <= startsAt) return false;

  const start = zonedParts(startsAt, timeZone);
  // last instant in window
  const endInstant = new Date(endsAt.getTime() - 1);
  const end = zonedParts(endInstant, timeZone);

  // MVP: same local calendar day
  if (
    start.year !== end.year ||
    start.month !== end.month ||
    start.day !== end.day
  ) {
    return false;
  }

  const startMin = start.hour * 60 + start.minute;
  let endMin = end.hour * 60 + end.minute + 1; // restore exclusive end in local minutes
  // If endsAt lands exactly on a local wall time minute boundary after -1ms adjust:
  // recompute exclusive end from endsAt itself
  const endExclusive = zonedParts(endsAt, timeZone);
  if (
    endExclusive.year === start.year &&
    endExclusive.month === start.month &&
    endExclusive.day === start.day
  ) {
    endMin = endExclusive.hour * 60 + endExclusive.minute;
  } else {
    // ends at midnight next day → 1440
    endMin = 1440;
  }

  return bookableHours.some(
    (h) =>
      h.weekday === start.weekday &&
      startMin >= h.startMinute &&
      endMin <= h.endMinute
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
