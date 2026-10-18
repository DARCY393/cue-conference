import { describe, expect, it, vi, beforeEach } from "vitest";
import { createBookingRequest } from "../lib/bookings";
import * as stripeLib from "../lib/stripe";
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

beforeEach(() => {
  resetStore();
  clearMock();
  vi.restoreAllMocks();
});

describe("every booking holds a payment", () => {
  it("creates a manual-capture PaymentIntent for the exact quote total", async () => {
    const spy = vi.spyOn(stripeLib, "createManualCapturePaymentIntent");
    const { startsAt, endsAt } = windowIso(1);
    const result = await createBookingRequest({
      spaceId: IDS.m1,
      startsAt,
      endsAt,
      guest: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    if (!("booking" in result)) throw new Error("expected a booking");

    expect(result.booking.totalCents).toBe(7000);
    expect(result.booking.stripePaymentIntentId).toBeTruthy();
    expect(result.stripe.captureMethod).toBe("manual");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 7000, currency: "usd" })
    );
  });

  it("never produces a booking with totalCents 0 or without a PaymentIntent", async () => {
    const { startsAt, endsAt } = windowIso(2);
    const result = await createBookingRequest({
      spaceId: IDS.m2,
      startsAt,
      endsAt,
      guest: { name: "Grace Hopper", email: "grace@example.com" },
    });
    if (!("booking" in result)) throw new Error("expected a booking");

    expect(result.booking.totalCents).toBeGreaterThan(0);
    expect(result.booking.stripePaymentIntentId).toBeTruthy();
  });

  it("there is no free/member path — every space.addons-less booking still pays", async () => {
    const { startsAt, endsAt } = windowIso(1, 3);
    const result = await createBookingRequest({
      spaceId: IDS.m3,
      startsAt,
      endsAt,
      guest: { name: "No Discount", email: "no-discount@example.com" },
    });
    if (!("booking" in result)) throw new Error("expected a booking");
    expect(result.booking.totalCents).toBe(3500);
    expect(result.booking.stripePaymentIntentId).toBeTruthy();
  });

  it("stores no booking row if PaymentIntent creation throws", async () => {
    vi.spyOn(stripeLib, "createManualCapturePaymentIntent").mockRejectedValue(
      new Error("stripe is down")
    );
    const { startsAt, endsAt } = windowIso(1, 6);
    await expect(
      createBookingRequest({
        spaceId: IDS.m4,
        startsAt,
        endsAt,
        guest: { name: "Should Fail", email: "should-fail@example.com" },
      })
    ).rejects.toThrow("stripe is down");

    expect(getStore().bookings.length).toBe(0);
  });
});
