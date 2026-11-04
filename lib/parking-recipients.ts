import { getBookingById } from "./bookings";
import { bookingAccessToken } from "./booking-access";
import { getEmailSender } from "./email";
import {
  renderHostParkingRecipientsEmail,
  renderHostParkingStatusEmail,
  renderParkingRecipientsRequestEmail,
} from "./email-templates";
import { getSpaceById } from "./space-service";
import { isDemoMode } from "./store";
import { query } from "./db";
import type { Booking } from "./types";

/** One pass holder: exactly one of a mobile number or an email (no names, per D'Arcy). */
export interface ParkingRecipient {
  phone?: string;
  email?: string;
}

export function recipientContact(r: ParkingRecipient): string {
  return r.phone || r.email || "";
}

/** Reminder goes out if the list is still empty this long before the booking starts. */
export const PARKING_REMINDER_HOURS = 48;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** US numbers → +1XXXXXXXXXX; "+" international numbers kept as +digits (8–15 digits). */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[^0-9+().\-\s]/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export type ValidateResult =
  | { ok: true; recipients: ParkingRecipient[] }
  | { ok: false; message: string; row?: number };

/**
 * Validates the guest's list. Each row is a single field (`contact`, or legacy `phone`/`email`)
 * holding a mobile number OR an email. Blank rows are dropped. At most `maxPasses` rows.
 */
export function validateParkingRecipients(input: unknown, maxPasses: number): ValidateResult {
  if (!Array.isArray(input)) return { ok: false, message: "recipients must be a list" };
  const out: ParkingRecipient[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const value = (
      typeof raw === "string"
        ? raw
        : [obj.contact, obj.phone, obj.email].find((v) => typeof v === "string" && v.trim()) ?? ""
    ) as string;
    const contact = value.trim();
    if (!contact) continue;
    const row = i + 1;
    if (contact.includes("@")) {
      const email = contact.toLowerCase();
      if (email.length > 254 || !EMAIL_RE.test(email)) {
        return { ok: false, row, message: `Pass ${row}: that email doesn't look right.` };
      }
      out.push({ email });
    } else {
      const phone = normalizePhone(contact);
      if (!phone) {
        return { ok: false, row, message: `Pass ${row}: enter a mobile number (e.g. 214-555-0123) or an email.` };
      }
      out.push({ phone });
    }
  }
  if (out.length > maxPasses) {
    return { ok: false, message: `This booking has ${maxPasses} parking pass${maxPasses === 1 ? "" : "es"}.` };
  }
  return { ok: true, recipients: out };
}

// ---- storage ---------------------------------------------------------------------------------

interface DemoParkingState {
  recipients: Map<string, ParkingRecipient[]>;
  meta: Map<string, ParkingMeta>;
}
function demo(): DemoParkingState {
  const g = globalThis as unknown as { __cueParking?: DemoParkingState };
  if (!g.__cueParking) g.__cueParking = { recipients: new Map(), meta: new Map() };
  return g.__cueParking;
}
/** Test helper. */
export function resetParkingDemoState(): void {
  const g = globalThis as unknown as { __cueParking?: DemoParkingState };
  g.__cueParking = undefined;
}

export interface ParkingMeta {
  requestSentAt?: string;
  reminderSentAt?: string;
  updatedAt?: string;
  issuedAt?: string;
  issuedBy?: string;
  issuedNote?: string;
  hostStatusSentAt?: string;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : undefined);

export async function getParkingMeta(bookingId: string): Promise<ParkingMeta> {
  if (isDemoMode()) return { ...(demo().meta.get(bookingId) ?? {}) };
  const { rows } = await query<Record<string, unknown>>(
    `SELECT parking_request_sent_at, parking_reminder_sent_at, parking_recipients_updated_at,
            parking_passes_issued_at, parking_passes_issued_by, parking_issued_note, parking_host_status_sent_at
     FROM bookings WHERE id = $1`,
    [bookingId]
  );
  const r = rows[0] ?? {};
  return {
    requestSentAt: iso(r.parking_request_sent_at),
    reminderSentAt: iso(r.parking_reminder_sent_at),
    updatedAt: iso(r.parking_recipients_updated_at),
    issuedAt: iso(r.parking_passes_issued_at),
    issuedBy: (r.parking_passes_issued_by as string) ?? undefined,
    issuedNote: (r.parking_issued_note as string) ?? undefined,
    hostStatusSentAt: iso(r.parking_host_status_sent_at),
  };
}

async function setMeta(bookingId: string, patch: ParkingMeta): Promise<void> {
  if (isDemoMode()) {
    demo().meta.set(bookingId, { ...(demo().meta.get(bookingId) ?? {}), ...patch });
    return;
  }
  const cols: string[] = [];
  const vals: unknown[] = [bookingId];
  const map: Record<keyof ParkingMeta, string> = {
    requestSentAt: "parking_request_sent_at",
    reminderSentAt: "parking_reminder_sent_at",
    updatedAt: "parking_recipients_updated_at",
    issuedAt: "parking_passes_issued_at",
    issuedBy: "parking_passes_issued_by",
    issuedNote: "parking_issued_note",
    hostStatusSentAt: "parking_host_status_sent_at",
  };
  for (const k of Object.keys(patch) as (keyof ParkingMeta)[]) {
    vals.push(patch[k] ?? null);
    cols.push(`${map[k]} = $${vals.length}`);
  }
  if (cols.length) await query(`UPDATE bookings SET ${cols.join(", ")} WHERE id = $1`, vals);
}

export async function getParkingRecipients(bookingId: string): Promise<ParkingRecipient[]> {
  if (isDemoMode()) return [...(demo().recipients.get(bookingId) ?? [])];
  const { rows } = await query<{ phone: string | null; email: string | null }>(
    `SELECT phone, email FROM parking_pass_recipients WHERE booking_id = $1 ORDER BY position`,
    [bookingId]
  );
  return rows.map((r) => ({
    ...(r.phone ? { phone: r.phone } : {}),
    ...(r.email ? { email: r.email } : {}),
  }));
}

async function replaceRecipients(bookingId: string, list: ParkingRecipient[]): Promise<void> {
  if (isDemoMode()) {
    demo().recipients.set(bookingId, list);
    return;
  }
  // One statement so a concurrent save can't interleave a half-written list.
  const payload = JSON.stringify(list.map((r, i) => ({ position: i + 1, ...r })));
  await query(
    `WITH del AS (DELETE FROM parking_pass_recipients WHERE booking_id = $1)
     INSERT INTO parking_pass_recipients (booking_id, position, phone, email)
     SELECT $1, (x->>'position')::int, x->>'phone', x->>'email'
     FROM jsonb_array_elements($2::jsonb) AS x`,
    [bookingId, payload]
  );
}

// ---- links + gating --------------------------------------------------------------------------

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://book.thecue.work").trim().replace(/\/+$/, "");
}
export function parkingPagePath(bookingId: string): string {
  return `/bookings/${encodeURIComponent(bookingId)}/parking?t=${bookingAccessToken(bookingId)}`;
}
export function parkingPageUrl(bookingId: string): string {
  return `${appBaseUrl()}${parkingPagePath(bookingId)}`;
}

/** The list can be filled in / edited while the booking is accepted and hasn't started. */
export function parkingEditable(b: Pick<Booking, "status" | "startsAt" | "parkingPasses">, now = new Date()): boolean {
  return b.status === "accepted" && (b.parkingPasses ?? 0) > 0 && new Date(b.startsAt) > now;
}

function roomName(b: Booking, space: { shortTitle?: string; title?: string } | null | undefined) {
  return space?.shortTitle || space?.title || b.spaceShortTitle || b.spaceTitle || "your room";
}

// ---- emails ----------------------------------------------------------------------------------

async function sendGuestParkingEmail(b: Booking, kind: "request" | "reminder") {
  const space = await getSpaceById(b.spaceId).catch(() => null);
  const email = renderParkingRecipientsRequestEmail({
    roomName: roomName(b, space),
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    parkingPasses: b.parkingPasses ?? 0,
    url: parkingPageUrl(b.id),
    reminder: kind === "reminder",
  });
  await getEmailSender().send({
    to: b.guestEmail || "guest@example.com",
    template: kind === "request" ? "parking_recipients_request" : "parking_recipients_reminder",
    bookingId: b.id,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
}

/**
 * Called right after a booking is accepted. Sends the "who's parking?" email once (idempotent via
 * parking_request_sent_at). If the booking starts within the reminder window, this email *is*
 * the reminder, so the reminder slot is marked used too.
 */
export async function sendParkingRequestOnAccept(b: Booking, now = new Date()): Promise<boolean> {
  if (!parkingEditable(b, now)) return false;
  const meta = await getParkingMeta(b.id);
  if (meta.requestSentAt) return false;
  await sendGuestParkingEmail(b, "request");
  const sentAt = new Date().toISOString();
  const soon = new Date(b.startsAt).getTime() - now.getTime() <= PARKING_REMINDER_HOURS * 3600_000;
  await setMeta(b.id, { requestSentAt: sentAt, ...(soon ? { reminderSentAt: sentAt } : {}) });
  return true;
}

/** Cron: one reminder per booking whose recipient list is still empty 48h before start. */
export async function sendDueParkingReminders(now: Date = new Date()): Promise<{ remindedIds: string[] }> {
  const windowEnd = new Date(now.getTime() + PARKING_REMINDER_HOURS * 3600_000);
  let ids: string[];
  if (isDemoMode()) {
    const { getStore } = await import("./store");
    ids = getStore()
      .bookings.filter(
        (b) =>
          b.status === "accepted" &&
          (b.parkingPasses ?? 0) > 0 &&
          new Date(b.startsAt) > now &&
          new Date(b.startsAt) <= windowEnd
      )
      .map((b) => b.id);
  } else {
    const { rows } = await query<{ id: string }>(
      `SELECT b.id FROM bookings b
       WHERE b.status = 'accepted' AND b.parking_passes > 0 AND b.parking_reminder_sent_at IS NULL
         AND b.starts_at > $1 AND b.starts_at <= $2
         AND NOT EXISTS (SELECT 1 FROM parking_pass_recipients r WHERE r.booking_id = b.id)`,
      [now.toISOString(), windowEnd.toISOString()]
    );
    ids = rows.map((r) => String(r.id));
  }
  const remindedIds: string[] = [];
  for (const id of ids) {
    const meta = await getParkingMeta(id);
    if (meta.reminderSentAt) continue;
    if ((await getParkingRecipients(id)).length > 0) continue;
    const b = await getBookingById(id);
    if (!b || !parkingEditable(b, now)) continue;
    // Mark first so a crash mid-send can't produce a second reminder.
    await setMeta(id, { reminderSentAt: new Date().toISOString() });
    await sendGuestParkingEmail(b, "reminder");
    remindedIds.push(id);
  }
  return { remindedIds };
}

export type SaveResult =
  | { ok: true; recipients: ParkingRecipient[] }
  | { ok: false; status: number; error: string; message: string };

/** Guest save from the tokenized page: replace the list, then alert staff. */
export async function saveParkingRecipients(bookingId: string, input: unknown, now = new Date()): Promise<SaveResult> {
  const b = await getBookingById(bookingId);
  if (!b || b.status === "draft") return { ok: false, status: 404, error: "not_found", message: "Booking not found" };
  if (!parkingEditable(b, now)) {
    return {
      ok: false,
      status: 409,
      error: "not_editable",
      message: "This parking list can't be changed any more. Please contact us.",
    };
  }
  const v = validateParkingRecipients(input, b.parkingPasses ?? 0);
  if (!v.ok) return { ok: false, status: 400, error: "invalid_recipients", message: v.message };
  if (v.recipients.length === 0) {
    return { ok: false, status: 400, error: "invalid_recipients", message: "Add at least one person." };
  }
  await replaceRecipients(bookingId, v.recipients);
  await setMeta(bookingId, { updatedAt: new Date().toISOString() });

  const space = await getSpaceById(b.spaceId).catch(() => null);
  const host = renderHostParkingRecipientsEmail({
    roomName: roomName(b, space),
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    parkingPasses: b.parkingPasses ?? 0,
    guestName: b.guestName || "Guest",
    guestEmail: b.guestEmail || "",
    bookingId: b.id,
    recipients: v.recipients,
  });
  await getEmailSender().send({
    to: process.env.HOST_EMAIL || "host@example.com",
    template: "host_parking_recipients",
    bookingId: b.id,
    subject: host.subject,
    html: host.html,
    text: host.text,
  });
  return { ok: true, recipients: v.recipients };
}

// ---- issued status + 24h host status email ---------------------------------------------------

/** Staff marks the passes issued (done by hand in Parkonect). `issued=false` clears it. */
export async function markParkingIssued(
  bookingId: string,
  opts: { issued?: boolean; by?: string; note?: string } = {}
): Promise<{ ok: true; meta: ParkingMeta } | { ok: false; status: number; error: string; message: string }> {
  const b = await getBookingById(bookingId);
  if (!b || b.status === "draft") return { ok: false, status: 404, error: "not_found", message: "Booking not found" };
  if (!(b.parkingPasses ?? 0)) return { ok: false, status: 409, error: "no_parking", message: "This booking has no parking passes" };
  if (opts.issued === false) {
    await setMeta(bookingId, { issuedAt: undefined, issuedBy: undefined, issuedNote: undefined });
  } else {
    await setMeta(bookingId, {
      issuedAt: new Date().toISOString(),
      issuedBy: opts.by?.slice(0, 200),
      issuedNote: opts.note?.slice(0, 500),
    });
  }
  return { ok: true, meta: await getParkingMeta(bookingId) };
}

export const PARKING_STATUS_HOURS = 24;

/**
 * Cron: once per accepted booking with parking, when it's within 24h of start, email the host
 * whether passes are ISSUED or NOT ISSUED. Bookings accepted inside 24h get it on the next run.
 */
export async function sendDueParkingStatusAlerts(now: Date = new Date()): Promise<{ sentIds: string[] }> {
  const windowEnd = new Date(now.getTime() + PARKING_STATUS_HOURS * 3600_000);
  let ids: string[];
  if (isDemoMode()) {
    const { getStore } = await import("./store");
    ids = getStore()
      .bookings.filter(
        (b) => b.status === "accepted" && (b.parkingPasses ?? 0) > 0 && new Date(b.startsAt) > now && new Date(b.startsAt) <= windowEnd
      )
      .map((b) => b.id);
  } else {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM bookings
       WHERE status = 'accepted' AND parking_passes > 0 AND parking_host_status_sent_at IS NULL
         AND starts_at > $1 AND starts_at <= $2`,
      [now.toISOString(), windowEnd.toISOString()]
    );
    ids = rows.map((r) => String(r.id));
  }
  const sentIds: string[] = [];
  for (const id of ids) {
    const meta = await getParkingMeta(id);
    if (meta.hostStatusSentAt) continue;
    const b = await getBookingById(id);
    if (!b || b.status !== "accepted") continue;
    await setMeta(id, { hostStatusSentAt: new Date().toISOString() });
    const recipients = await getParkingRecipients(id);
    const space = await getSpaceById(b.spaceId).catch(() => null);
    const email = renderHostParkingStatusEmail({
      roomName: roomName(b, space),
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      parkingPasses: b.parkingPasses ?? 0,
      guestName: b.guestName || "Guest",
      guestEmail: b.guestEmail || "",
      bookingId: b.id,
      recipients,
      issuedAt: meta.issuedAt,
      issuedBy: meta.issuedBy,
      issuedNote: meta.issuedNote,
    });
    await getEmailSender().send({
      to: process.env.HOST_EMAIL || "host@example.com",
      template: "host_parking_status",
      bookingId: id,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    sentIds.push(id);
  }
  return { sentIds };
}
