import { getBookingById } from "./bookings";
import { getEmailSender } from "./email";
import { cancelPageUrl } from "./booking-access";
import { renderBookingReminderEmail } from "./email-templates";
import { getSpaceById } from "./space-service";
import { getStore, isDemoMode } from "./store";
import { query } from "./db";

const REMINDER_WINDOW_HOURS = 24;

async function findCandidateIds(now: Date, windowEnd: Date): Promise<string[]> {
  if (isDemoMode()) {
    return getStore()
      .bookings.filter(
        (b) =>
          b.status === "accepted" &&
          !b.reminderSentAt &&
          new Date(b.startsAt) > now &&
          new Date(b.startsAt) <= windowEnd
      )
      .map((b) => b.id);
  }
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM bookings
     WHERE status = 'accepted' AND reminder_sent_at IS NULL
       AND starts_at > now() AND starts_at <= $1`,
    [windowEnd.toISOString()]
  );
  return rows.map((r) => String(r.id));
}

/**
 * Sends a 24h-before-start reminder to every accepted booking that hasn't
 * been reminded yet, then marks it sent. Idempotent — safe to call as often
 * as the cron likes: each candidate is re-checked for `reminderSentAt` right
 * before sending, and the DB/demo query only ever selects bookings where it's
 * still null.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<{ remindedIds: string[] }> {
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);
  const ids = await findCandidateIds(now, windowEnd);

  const remindedIds: string[] = [];
  for (const id of ids) {
    const booking = await getBookingById(id);
    if (!booking || booking.status !== "accepted" || booking.reminderSentAt) continue;

    const space = await getSpaceById(booking.spaceId);
    const roomName = space?.shortTitle || space?.title || booking.spaceTitle || "your room";
    const { subject, html, text } = renderBookingReminderEmail({
      roomName,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      totalCents: booking.totalCents,
      parkingPasses: booking.parkingPasses ?? 0,
      parkingCents: booking.parkingCents ?? 0,
      bookingId: booking.id,
      cancelUrl: cancelPageUrl(booking.id),
    });
    await getEmailSender().send({
      to: booking.guestEmail || "guest@example.com",
      template: "booking_reminder",
      bookingId: id,
      subject,
      html,
      text,
    });

    const sentAt = new Date().toISOString();
    if (isDemoMode()) {
      getStore().updateBooking(id, { reminderSentAt: sentAt });
    } else {
      await query(`UPDATE bookings SET reminder_sent_at = $2 WHERE id = $1`, [id, sentAt]);
    }
    remindedIds.push(id);
  }
  return { remindedIds };
}
