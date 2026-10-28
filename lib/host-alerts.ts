/** Short, scannable wording shared by host alert emails and texts. All times America/Chicago. */
const TZ = "America/Chicago";

const FREEMAIL = new Set([
  "gmail", "googlemail", "yahoo", "ymail", "hotmail", "outlook", "live", "msn", "aol", "icloud",
  "me", "mac", "proton", "protonmail", "gmx", "mail", "comcast", "att", "sbcglobal", "verizon", "example",
  // Our own domain: staff test bookings should not read as a company.
  "thecue",
]);

/** "Integrity" from allison@integrity.com; undefined for personal mailboxes. */
export function companyFromEmail(email: string | undefined): string | undefined {
  const domain = (email || "").split("@")[1]?.toLowerCase().trim();
  if (!domain) return undefined;
  const labels = domain.split(".");
  if (labels.length < 2) return undefined;
  // co.uk-style: take the label before a 2-letter second-level.
  let name = labels[labels.length - 2];
  if (labels.length >= 3 && name.length <= 3 && labels[labels.length - 1].length === 2) name = labels[labels.length - 3];
  if (!name || FREEMAIL.has(name)) return undefined;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function parts(iso: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "short", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value || "";
  return { month: get("month"), day: get("day"), weekday: get("weekday"), time: `${get("hour")}:${get("minute")} ${get("dayPeriod")}` };
}

function shortTime(t: string): string {
  return t.replace(":00 ", " ");
}

/** "Nov 4–5", "Oct 31–Nov 2", or "Oct 29 9 AM–12 PM" for a single day. */
export function shortDateRange(startsAt: string, endsAt: string): string {
  const s = parts(startsAt);
  // An end exactly at midnight belongs to the previous day.
  const e = parts(new Date(new Date(endsAt).getTime() - 1).toISOString());
  const eExact = parts(endsAt);
  if (s.month === e.month && s.day === e.day) {
    return `${s.month} ${s.day} ${shortTime(s.time)}–${shortTime(eExact.time)}`;
  }
  return s.month === e.month ? `${s.month} ${s.day}–${e.day}` : `${s.month} ${s.day}–${e.month} ${e.day}`;
}

/** "Tue 3:54 PM" */
export function shortDeadline(iso: string): string {
  const p = parts(iso);
  return `${p.weekday} ${p.time}`;
}

/** "$976" for whole dollars, "$976.50" otherwise. */
export function shortMoney(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function guestLabel(name: string | undefined, email: string | undefined): string {
  const n = (name || "").trim() || "Guest";
  const c = companyFromEmail(email);
  return c ? `${n} (${c})` : n;
}

export interface HostAlertFacts {
  roomName: string;
  startsAt: string;
  endsAt: string;
  totalCents: number;
  guestName?: string;
  guestEmail?: string;
  hostActionDeadlineAt?: string;
}

export function hostQueueUrl(): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL || "https://book.thecue.work").trim().replace(/\/+$/, "")}/host`;
}

export function newRequestSubject(f: HostAlertFacts): string {
  return `🔔 ACTION NEEDED: New booking request — ${f.roomName} ${shortDateRange(f.startsAt, f.endsAt)} — ${guestLabel(f.guestName, f.guestEmail)} (${shortMoney(f.totalCents)})`;
}

export function newRequestSms(f: HostAlertFacts): string {
  const by = f.hostActionDeadlineAt ? ` Accept by ${shortDeadline(f.hostActionDeadlineAt)}:` : "";
  return `Cue: NEW request ${f.roomName} ${shortDateRange(f.startsAt, f.endsAt)}, ${guestLabel(f.guestName, f.guestEmail)}, ${shortMoney(f.totalCents)}.${by} ${hostQueueUrl()}`;
}

export type CancelAction = "release_hold" | "refund" | "no_refund";

function cancelOutcome(action: CancelAction, refundCents: number): string {
  return action === "release_hold" ? "hold released" : action === "refund" ? `refund ${shortMoney(refundCents)}` : "no refund";
}

export function cancelledSubject(f: HostAlertFacts & { action: CancelAction; refundCents: number; cancelledBy: "guest" | "staff" }): string {
  return `Cancelled: ${f.roomName} ${shortDateRange(f.startsAt, f.endsAt)} — ${guestLabel(f.guestName, f.guestEmail)} — ${cancelOutcome(f.action, f.refundCents)} (by ${f.cancelledBy})`;
}

export function cancelledSms(f: HostAlertFacts & { action: CancelAction; refundCents: number; cancelledBy: "guest" | "staff" }): string {
  return `Cue: CANCELLED by ${f.cancelledBy} — ${f.roomName} ${shortDateRange(f.startsAt, f.endsAt)}, ${guestLabel(f.guestName, f.guestEmail)}, ${cancelOutcome(f.action, f.refundCents)}.`;
}

export function reminderSubject(f: HostAlertFacts, hoursLabel: string): string {
  return `⏰ Reminder: booking request auto-declines in ${hoursLabel} — ${f.roomName} ${shortDateRange(f.startsAt, f.endsAt)} — ${guestLabel(f.guestName, f.guestEmail)} (${shortMoney(f.totalCents)})`;
}

export function reminderSms(f: HostAlertFacts, hoursLabel: string): string {
  const by = f.hostActionDeadlineAt ? ` at ${shortDeadline(f.hostActionDeadlineAt)}` : "";
  return `Cue REMINDER: request ${f.roomName} ${shortDateRange(f.startsAt, f.endsAt)}, ${guestLabel(f.guestName, f.guestEmail)}, ${shortMoney(f.totalCents)} auto-declines in ${hoursLabel}${by}. ${hostQueueUrl()}`;
}
