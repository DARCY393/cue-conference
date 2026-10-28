/**
 * Host decision reminders. A request still 'requested' gets one reminder 6h before its
 * auto-decline deadline and one 2h before (email to HOST_EMAIL + text to HOST_ALERT_SMS_TO).
 * If a request is already inside 2h when first seen, only the 2h reminder goes out.
 * Each reminder is claimed in the DB (column set WHERE still null AND still requested) before
 * sending, so overlapping or repeated runs of the 15-minute job never double-send.
 */
import { getBookingById } from "./bookings";
import { getEmailSender } from "./email";
import { renderHostDecisionReminderEmail } from "./email-templates";
import { reminderSms } from "./host-alerts";
import { sendHostSms } from "./sms";
import { getSpaceById } from "./space-service";
import { getStore, isDemoMode } from "./store";
import { query } from "./db";
import type { Booking } from "./types";

const HOUR = 60 * 60 * 1000;
export type HostReminderSlot = "6h" | "2h";

/** Which reminder (if any) is due for this booking at `now`. Pure; exported for tests. */
export function dueHostReminder(
  b: Pick<Booking, "status" | "hostActionDeadlineAt" | "hostReminder6hSentAt" | "hostReminder2hSentAt">,
  now: Date
): HostReminderSlot | null {
  if (b.status !== "requested" || !b.hostActionDeadlineAt) return null;
  const left = new Date(b.hostActionDeadlineAt).getTime() - now.getTime();
  if (left <= 0) return null; // the expire job handles it
  if (left <= 2 * HOUR) return b.hostReminder2hSentAt ? null : "2h";
  if (left <= 6 * HOUR) return b.hostReminder6hSentAt || b.hostReminder2hSentAt ? null : "6h";
  return null;
}

async function candidateIds(now: Date): Promise<string[]> {
  const windowEnd = new Date(now.getTime() + 6 * HOUR);
  if (isDemoMode()) {
    return getStore()
      .bookings.filter((b) => dueHostReminder(b, now) !== null)
      .map((b) => b.id);
  }
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM bookings
     WHERE status = 'requested' AND host_reminder_2h_sent_at IS NULL
       AND host_action_deadline_at > $1 AND host_action_deadline_at <= $2`,
    [now.toISOString(), windowEnd.toISOString()]
  );
  return rows.map((r) => String(r.id));
}

/** Atomically claim a slot. Claiming 2h also fills 6h so a late 6h can never follow. */
async function claim(id: string, slot: HostReminderSlot, now: Date): Promise<boolean> {
  const at = now.toISOString();
  if (isDemoMode()) {
    const b = getStore().getBooking(id);
    if (!b || dueHostReminder(b, now) !== slot) return false;
    getStore().updateBooking(
      id,
      slot === "2h"
        ? { hostReminder2hSentAt: at, hostReminder6hSentAt: b.hostReminder6hSentAt ?? at }
        : { hostReminder6hSentAt: at }
    );
    return true;
  }
  const sql =
    slot === "2h"
      ? `UPDATE bookings SET host_reminder_2h_sent_at = $2,
           host_reminder_6h_sent_at = COALESCE(host_reminder_6h_sent_at, $2)
         WHERE id = $1 AND status = 'requested' AND host_reminder_2h_sent_at IS NULL RETURNING id`
      : `UPDATE bookings SET host_reminder_6h_sent_at = $2
         WHERE id = $1 AND status = 'requested' AND host_reminder_6h_sent_at IS NULL
           AND host_reminder_2h_sent_at IS NULL RETURNING id`;
  const { rows } = await query<{ id: string }>(sql, [id, at]);
  return rows.length > 0;
}

function hoursLabel(deadlineIso: string, now: Date): string {
  const mins = Math.max(1, Math.round((new Date(deadlineIso).getTime() - now.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m >= 15 ? `${h}h ${m}m` : `${h}h`;
}

export async function sendHostDecisionReminders(
  now: Date = new Date()
): Promise<{ reminded: { id: string; slot: HostReminderSlot }[] }> {
  const reminded: { id: string; slot: HostReminderSlot }[] = [];
  for (const id of await candidateIds(now)) {
    const booking = await getBookingById(id);
    if (!booking) continue;
    const slot = dueHostReminder(booking, now);
    if (!slot || !(await claim(id, slot, now))) continue;
    const space = await getSpaceById(booking.spaceId);
    const roomName = space?.shortTitle || space?.title || booking.spaceTitle || "Room";
    const label = hoursLabel(booking.hostActionDeadlineAt!, now);
    const facts = {
      roomName,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      totalCents: booking.totalCents,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      hostActionDeadlineAt: booking.hostActionDeadlineAt,
    };
    try {
      const email = renderHostDecisionReminderEmail({
        ...facts,
        parkingPasses: booking.parkingPasses ?? 0,
        parkingCents: booking.parkingCents ?? 0,
        bookingId: booking.id,
        guestName: booking.guestName || "Guest",
        guestEmail: booking.guestEmail || "",
        hoursLabel: label,
      });
      await getEmailSender().send({
        to: process.env.HOST_EMAIL || "host@example.com",
        template: `host_decision_reminder_${slot}`,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (err) {
      console.error(`[host-reminder] ${id}: email failed`, err instanceof Error ? err.message : err);
    }
    await sendHostSms(reminderSms(facts, label), `reminder_${slot} ${id}`);
    reminded.push({ id, slot });
  }
  return { reminded };
}
