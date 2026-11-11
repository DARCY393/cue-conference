import { bookingAccessToken } from "./booking-access";
import { getBookingById } from "./bookings";
import { query } from "./db";
import { getEmailSender } from "./email";
import { renderFeedbackRequestEmail, renderHostFeedbackEmail } from "./email-templates";
import { getStore, isDemoMode } from "./store";
import { HOST_EMAIL_DEFAULT } from "./seed";
import { getSpaceById } from "./space-service";
import type { Booking } from "./types";

export type Rating = 1 | 2 | 3 | 4 | 5;
export type Feedback = { rating: Rating; comment: string };
export function isRating(value: unknown): value is Rating {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}
const demoFeedback = new Map<string, Feedback>();
const demoSent = new Set<string>();
const demoNotified = new Set<string>();
export function resetFeedbackDemoState() { demoFeedback.clear(); demoSent.clear(); demoNotified.clear(); }

export function feedbackPageUrl(id: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://book.thecue.work").replace(/\/+$/, "");
  return `${base}/bookings/${encodeURIComponent(id)}/feedback?t=${bookingAccessToken(id)}`;
}

/** Compare Chicago wall dates/hours, not elapsed 24h: DST and multi-day stays are handled. */
export function feedbackIsDue(endsAt: string, now: Date): boolean {
  const parts = (date: Date) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const val = (type: string) => p.find((x) => x.type === type)?.value || "";
    return { day: `${val("year")}-${val("month")}-${val("day")}`, hour: Number(val("hour")) };
  };
  const end = parts(new Date(endsAt));
  const current = parts(now);
  // Once the next-day 9 AM threshold has passed, later missed days are always eligible.
  const next = new Date(`${end.day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDay = next.toISOString().slice(0, 10);
  return current.day > nextDay || (current.day === nextDay && current.hour >= 9);
}

export async function getFeedback(id: string): Promise<Feedback | null> {
  if (isDemoMode()) return demoFeedback.get(id) || null;
  const { rows } = await query<{ rating: unknown; comment: string }>("SELECT rating, comment FROM booking_feedback WHERE booking_id = $1", [id]);
  const row = rows[0];
  return row && isRating(row.rating) ? { rating: row.rating, comment: row.comment } : null;
}

async function emailParams(b: Booking) {
  const space = await getSpaceById(b.spaceId);
  return { roomName: space?.shortTitle || b.spaceShortTitle || b.spaceTitle || "Conference room", startsAt: b.startsAt, endsAt: b.endsAt, url: feedbackPageUrl(b.id) };
}

/** Disabled until explicitly enabled on the deployment. The migration cutoff never moves. */
export async function sendDueFeedbackRequests(now = new Date()): Promise<{ sentIds: string[] }> {
  if (process.env.FEEDBACK_ENABLED !== "true") return { sentIds: [] };
  let candidates: { id: string }[];
  if (isDemoMode()) {
    const cutoff = process.env.FEEDBACK_STARTS_AT;
    if (!cutoff || !Number.isFinite(Date.parse(cutoff))) return { sentIds: [] };
    candidates = getStore().bookings.filter((b) => b.status === "completed" && new Date(b.endsAt) >= new Date(cutoff)).map((b) => ({ id: b.id }));
  } else {
    const result = await query<{ id: string }>(`SELECT b.id FROM bookings b CROSS JOIN feedback_rollout f
      WHERE b.status = 'completed' AND b.ends_at >= f.activated_at
        AND b.feedback_request_sent_at IS NULL
        AND $1::timestamptz >= (((b.ends_at AT TIME ZONE 'America/Chicago')::date + 1 + time '09:00') AT TIME ZONE 'America/Chicago')`, [now.toISOString()]);
    candidates = result.rows;
  }
  const sentIds: string[] = [];
  for (const { id } of candidates) {
    const b = await getBookingById(id);
    if (!b || b.status !== "completed" || !b.guestEmail?.trim() || !feedbackIsDue(b.endsAt, now)) continue;
    // Preview feedback requests can never reach a real guest, even if enabled accidentally.
    if (process.env.CUE_APP_ENV === "preview" && !b.guestEmail.toLowerCase().endsWith("@mail.grokbot.com")) continue;
    const email = renderFeedbackRequestEmail(await emailParams(b));
    if (isDemoMode()) {
      if (demoSent.has(id)) continue;
      demoSent.add(id);
    } else {
      const claim = await query(`UPDATE bookings SET feedback_request_sent_at = $2
        WHERE id = $1 AND status = 'completed' AND feedback_request_sent_at IS NULL RETURNING id`, [id, now.toISOString()]);
      if (!claim.rowCount) continue;
    }
    const result = await getEmailSender().send({ to: b.guestEmail, bookingId: id, template: "feedback_request", ...email });
    if (result && result.status !== "sent") {
      if (isDemoMode()) demoSent.delete(id);
      else await query("UPDATE bookings SET feedback_request_sent_at = NULL WHERE id = $1 AND feedback_request_sent_at = $2", [id, now.toISOString()]);
    } else sentIds.push(id);
  }
  return { sentIds };
}

export type FeedbackResult = { ok: true; feedback: Feedback; alertStatus: "sent" | "failed" | "not_requested" | "unchanged" } | { ok: false; status: number; message: string };
/** Automatic rating saves preserve the existing comment; explicit Submit also alerts staff. */
export async function saveFeedback(id: string, input: unknown, notifyHost: boolean): Promise<FeedbackResult> {
  if (!input || typeof input !== "object" || !("rating" in input) || !isRating(input.rating)) return { ok: false, status: 400, message: "Choose a rating from 1 to 5." };
  if ("comment" in input && (typeof input.comment !== "string" || input.comment.length > 4000)) return { ok: false, status: 400, message: "Please keep your comment to 4,000 characters." };
  const b = await getBookingById(id);
  if (!b || b.status !== "completed" || new Date(b.endsAt) > new Date()) return { ok: false, status: 404, message: "Feedback is available after your booking is completed." };
  const previous = await getFeedback(id);
  let feedback: Feedback = { rating: input.rating, comment: "comment" in input && typeof input.comment === "string" ? input.comment.trim() : previous?.comment || "" };
  if (isDemoMode()) {
    if (previous?.rating !== feedback.rating || previous?.comment !== feedback.comment) demoNotified.delete(id);
    demoFeedback.set(id, feedback);
  } else {
    const saved = await query<{ rating: Rating; comment: string }>(`INSERT INTO booking_feedback (booking_id, rating, comment) VALUES ($1,$2,COALESCE($3, ''))
      ON CONFLICT (booking_id) DO UPDATE SET rating = EXCLUDED.rating,
      comment = COALESCE($3, booking_feedback.comment),
      updated_at = CASE WHEN booking_feedback.rating = EXCLUDED.rating AND booking_feedback.comment = COALESCE($3, booking_feedback.comment)
        THEN booking_feedback.updated_at ELSE now() END,
      host_notified_at = CASE WHEN booking_feedback.rating = EXCLUDED.rating AND booking_feedback.comment = COALESCE($3, booking_feedback.comment)
        THEN booking_feedback.host_notified_at ELSE NULL END
      RETURNING rating, comment`, [id, feedback.rating, "comment" in input ? feedback.comment : null]);
    feedback = saved.rows[0];
  }
  if (!notifyHost) return { ok: true, feedback, alertStatus: "not_requested" };
  const email = renderHostFeedbackEmail({ ...await emailParams(b), ...feedback, bookingId: id });
  if (isDemoMode()) {
    if (demoNotified.has(id)) return { ok: true, feedback, alertStatus: "unchanged" };
    demoNotified.add(id);
  } else {
    const claim = await query(`UPDATE booking_feedback SET host_notified_at = now()
      WHERE booking_id = $1 AND rating = $2 AND comment = $3 AND host_notified_at IS NULL RETURNING booking_id`, [id, feedback.rating, feedback.comment]);
    if (!claim.rowCount) return { ok: true, feedback, alertStatus: "unchanged" };
  }
  const result = await getEmailSender().send({ to: process.env.HOST_EMAIL || HOST_EMAIL_DEFAULT, bookingId: id, template: "host_feedback", ...email });
  if (result && result.status !== "sent") {
    if (isDemoMode()) demoNotified.delete(id);
    else await query("UPDATE booking_feedback SET host_notified_at = NULL WHERE booking_id = $1 AND rating = $2 AND comment = $3", [id, feedback.rating, feedback.comment]);
    return { ok: true, feedback, alertStatus: "failed" };
  }
  return { ok: true, feedback, alertStatus: "sent" };
}
