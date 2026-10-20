import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createBookingRequest,
  acceptBooking,
  cancelBooking,
  expireBookingRequest,
  expireOverdueRequests,
  listHostBookings,
} from "../lib/bookings";
import * as stripeLib from "../lib/stripe";
import { IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";

// Monday 2027-01-04, 9:00 America/Chicago (CST, UTC-6 in January) = 15:00 UTC.
// Frozen as "now" for every test so hours-before-start math is deterministic.
const MON_9AM = new Date("2027-01-04T15:00:00.000Z");

function windowIso(hours: number, offsetHours = 0) {
  const start = new Date(MON_9AM.getTime() + offsetHours * 60 * 60 * 1000);
  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

async function requestBooking(spaceId: string, email: string, offsetHours = 0) {
  const { startsAt, endsAt } = windowIso(1, offsetHours);
  const result = await createBookingRequest({
    spaceId,
    startsAt,
    endsAt,
    guest: { name: "Guest", email },
  });
  if (!("booking" in result)) throw new Error("expected a booking");
  return result.booking;
}

beforeEach(() => {
  resetStore();
  clearMock();
  vi.restoreAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(MON_9AM);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cancelBooking — 48h free-cancellation policy", () => {
  it("releases the hold (no refund call) when cancelling a still-requested booking, even far out", async () => {
    const cancelSpy = vi.spyOn(stripeLib, "cancelPaymentIntent");
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const booking = await requestBooking(IDS.m1, "far-out@example.com", 24 * 30);

    const result = await cancelBooking(booking.id);
    if (!("booking" in result)) throw new Error("expected cancellation");

    expect(result.booking.status).toBe("cancelled");
    expect(result.refundCents).toBe(0);
    expect(cancelSpy).toHaveBeenCalledWith(booking.stripePaymentIntentId);
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it("full refund when an accepted (captured) booking is cancelled ≥48h before start", async () => {
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const booking = await requestBooking(IDS.m2, "plenty-of-notice@example.com", 72);
    const accepted = await acceptBooking(booking.id);
    if (!("booking" in accepted) || !accepted.booking) throw new Error("expected acceptance");

    const result = await cancelBooking(booking.id);
    if (!("booking" in result)) throw new Error("expected cancellation");

    expect(result.booking.status).toBe("cancelled");
    expect(result.refundCents).toBe(accepted.booking.totalCents);
    expect(refundSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: accepted.booking.totalCents })
    );
  });

  it("exactly 48h before start is still free (boundary)", async () => {
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const booking = await requestBooking(IDS.m3, "boundary@example.com", 48);
    const accepted = await acceptBooking(booking.id);
    if (!("booking" in accepted) || !accepted.booking) throw new Error("expected acceptance");

    const result = await cancelBooking(booking.id);
    if (!("booking" in result)) throw new Error("expected cancellation");

    expect(result.refundCents).toBe(accepted.booking.totalCents);
    expect(refundSpy).toHaveBeenCalled();
  });

  it("no refund when an accepted (captured) booking is cancelled inside the 48h window", async () => {
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const cancelSpy = vi.spyOn(stripeLib, "cancelPaymentIntent");
    // Starts only 2h from "now" — well inside the 48h window.
    const booking = await requestBooking(IDS.m3, "last-minute@example.com", 2);
    await acceptBooking(booking.id);

    const result = await cancelBooking(booking.id);
    if (!("booking" in result)) throw new Error("expected cancellation");

    expect(result.booking.status).toBe("cancelled");
    expect(result.refundCents).toBe(0);
    expect(refundSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it("rejects cancelling a booking that's already been declined", async () => {
    const booking = await requestBooking(IDS.m4, "declined@example.com");
    getStore().updateBooking(booking.id, { status: "declined" });

    const result = await cancelBooking(booking.id);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(409);
  });
});

describe("expireBookingRequest — idempotent 24h staff response window", () => {
  it("auto-declines a still-requested booking past its deadline and releases the hold", async () => {
    const cancelSpy = vi.spyOn(stripeLib, "cancelPaymentIntent");
    const booking = await requestBooking(IDS.m1, "overdue@example.com");
    getStore().updateBooking(booking.id, {
      hostActionDeadlineAt: new Date(MON_9AM.getTime() - 60 * 60 * 1000).toISOString(),
    });

    const result = await expireBookingRequest(booking.id);
    if (!("booking" in result) || !result.booking) throw new Error("expected expiry");
    expect(result.booking.status).toBe("expired");
    expect(cancelSpy).toHaveBeenCalledWith(booking.stripePaymentIntentId);
  });

  it("is a no-op the second time (already past 'requested')", async () => {
    const cancelSpy = vi.spyOn(stripeLib, "cancelPaymentIntent");
    const booking = await requestBooking(IDS.m2, "overdue2@example.com");
    getStore().updateBooking(booking.id, {
      hostActionDeadlineAt: new Date(MON_9AM.getTime() - 60 * 60 * 1000).toISOString(),
    });

    await expireBookingRequest(booking.id);
    cancelSpy.mockClear();
    const second = await expireBookingRequest(booking.id);

    expect("error" in second).toBe(true);
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it("does not touch a booking whose deadline hasn't passed", async () => {
    const cancelSpy = vi.spyOn(stripeLib, "cancelPaymentIntent");
    const booking = await requestBooking(IDS.m3, "not-overdue@example.com");
    const result = await expireBookingRequest(booking.id);
    // Deadline is 24h from "now" (frozen at request time), so it hasn't passed yet.
    expect("error" in result).toBe(true);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(getStore().getBooking(booking.id)?.status).toBe("requested");
  });
});

describe("expireOverdueRequests — bulk scan", () => {
  it("expires every overdue request and leaves others untouched", async () => {
    const overdue = await requestBooking(IDS.m1, "bulk-overdue@example.com");
    const current = await requestBooking(IDS.m2, "bulk-current@example.com", 3);
    getStore().updateBooking(overdue.id, {
      hostActionDeadlineAt: new Date(MON_9AM.getTime() - 60 * 60 * 1000).toISOString(),
    });

    const result = await expireOverdueRequests();
    expect(result.expiredIds).toEqual([overdue.id]);
    expect(getStore().getBooking(overdue.id)?.status).toBe("expired");
    expect(getStore().getBooking(current.id)?.status).toBe("requested");

    const again = await expireOverdueRequests();
    expect(again.expiredIds).toEqual([]);
  });

  it("listHostBookings lazily expires overdue requests before returning them", async () => {
    const overdue = await requestBooking(IDS.m4, "lazy-overdue@example.com");
    getStore().updateBooking(overdue.id, {
      hostActionDeadlineAt: new Date(MON_9AM.getTime() - 60 * 60 * 1000).toISOString(),
    });

    const rows = await listHostBookings({});
    const row = rows.find((b) => b.id === overdue.id);
    expect(row?.status).toBe("expired");
  });
});
