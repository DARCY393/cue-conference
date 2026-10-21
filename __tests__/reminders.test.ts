import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createBookingRequest, acceptBooking } from "../lib/bookings";
import { sendDueReminders } from "../lib/reminders";
import { setEmailSender, type EmailMessage } from "../lib/email";
import { IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";

// Monday 2027-01-04, 9:00 America/Chicago (CST, UTC-6 in January) = 15:00 UTC.
const MON_9AM = new Date("2027-01-04T15:00:00.000Z");

function windowIso(hours: number, offsetHours = 0) {
  const start = new Date(MON_9AM.getTime() + offsetHours * 60 * 60 * 1000);
  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

async function acceptedBooking(spaceId: string, email: string, startOffsetHours: number) {
  const { startsAt, endsAt } = windowIso(1, startOffsetHours);
  const requested = await createBookingRequest({
    spaceId,
    startsAt,
    endsAt,
    guest: { name: "Guest", email },
  });
  if (!("booking" in requested)) throw new Error("expected a booking: " + JSON.stringify(requested));
  const accepted = await acceptBooking(requested.booking.id);
  if (!("booking" in accepted) || !accepted.booking) throw new Error("expected acceptance");
  return accepted.booking;
}

describe("sendDueReminders", () => {
  let sent: EmailMessage[];

  beforeEach(() => {
    resetStore();
    clearMock();
    vi.useFakeTimers();
    vi.setSystemTime(MON_9AM);
    sent = [];
    setEmailSender({
      async send(message: EmailMessage) {
        sent.push(message);
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    setEmailSender(null);
  });

  it("reminds an accepted booking starting within 24h and marks it sent", async () => {
    const booking = await acceptedBooking(IDS.m1, "soon@example.com", 2);

    const result = await sendDueReminders(MON_9AM);
    expect(result.remindedIds).toEqual([booking.id]);
    expect(sent.filter((m) => m.template === "booking_reminder")).toHaveLength(1);
    expect(sent.filter((m) => m.template === "booking_reminder")[0].template).toBe("booking_reminder");
    expect(sent.filter((m) => m.template === "booking_reminder")[0].to).toBe("soon@example.com");

    expect(getStore().getBooking(booking.id)?.reminderSentAt).toBeTruthy();
  });

  it("is idempotent — a second run sends nothing more for the same booking", async () => {
    await acceptedBooking(IDS.m2, "idempotent@example.com", 2);

    const first = await sendDueReminders(MON_9AM);
    expect(first.remindedIds).toHaveLength(1);
    sent.length = 0;

    const second = await sendDueReminders(MON_9AM);
    expect(second.remindedIds).toHaveLength(0);
    expect(sent.filter((m) => m.template === "booking_reminder")).toHaveLength(0);
  });

  it("does not remind a booking starting more than 24h out", async () => {
    await acceptedBooking(IDS.m3, "later@example.com", 48);

    const result = await sendDueReminders(MON_9AM);
    expect(result.remindedIds).toHaveLength(0);
    expect(sent.filter((m) => m.template === "booking_reminder")).toHaveLength(0);
  });

  it("does not remind a booking that already started", async () => {
    const booking = await acceptedBooking(IDS.m4, "past@example.com", 1);
    // Simulate "now" moving past the start.
    const later = new Date(MON_9AM.getTime() + 6 * 60 * 60 * 1000);

    const result = await sendDueReminders(later);
    expect(result.remindedIds).toHaveLength(0);
    expect(getStore().getBooking(booking.id)?.reminderSentAt).toBeFalsy();
  });

  it("does not remind a still-requested (not yet accepted) booking", async () => {
    const { startsAt, endsAt } = windowIso(1, 2);
    const requested = await createBookingRequest({
      spaceId: IDS.m1,
      startsAt,
      endsAt,
      guest: { name: "Guest", email: "requested@example.com" },
    });
    if (!("booking" in requested)) throw new Error("expected a booking: " + JSON.stringify(requested));

    const result = await sendDueReminders(MON_9AM);
    expect(result.remindedIds).toHaveLength(0);
  });
});
