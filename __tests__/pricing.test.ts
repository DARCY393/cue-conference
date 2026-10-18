import { describe, expect, it, beforeEach } from "vitest";
import { calculateQuote } from "../lib/quote";
import { createQuoteForSpace, createBookingRequest } from "../lib/bookings";
import { CUE_M1, CUE_M2, CUE_M3, CUE_M4, IDS } from "../lib/seed";
import { resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";

// Monday 2027-01-04, 9:00 America/Chicago (CST, UTC-6 in January) = 15:00 UTC.
const MON_9AM = new Date("2027-01-04T15:00:00.000Z");

function at(hoursFromMon9am: number): Date {
  return new Date(MON_9AM.getTime() + hoursFromMon9am * 60 * 60 * 1000);
}

beforeEach(() => {
  resetStore();
  clearMock();
});

describe("per-room pricing (seed rates)", () => {
  it("M3 1h = 3500", () => {
    const q = calculateQuote({
      startsAt: at(0),
      endsAt: at(1),
      pricing: CUE_M3.pricing,
      addonsCatalog: CUE_M3.addons,
    });
    expect(q.totalCents).toBe(3500);
  });

  it("M2 2h = 25000", () => {
    const q = calculateQuote({
      startsAt: at(0),
      endsAt: at(2),
      pricing: CUE_M2.pricing,
      addonsCatalog: CUE_M2.addons,
    });
    expect(q.totalCents).toBe(25000);
  });

  it("M1 1h = 7000", () => {
    const q = calculateQuote({
      startsAt: at(0),
      endsAt: at(1),
      pricing: CUE_M1.pricing,
      addonsCatalog: CUE_M1.addons,
    });
    expect(q.totalCents).toBe(7000);
  });

  it("M4 1h = 7000", () => {
    const q = calculateQuote({
      startsAt: at(0),
      endsAt: at(1),
      pricing: CUE_M4.pricing,
      addonsCatalog: CUE_M4.addons,
    });
    expect(q.totalCents).toBe(7000);
  });

  it("changing a room's baseHourlyCents changes the quote", () => {
    const customPricing = { ...CUE_M1.pricing, baseHourlyCents: 9900 };
    const q = calculateQuote({
      startsAt: at(0),
      endsAt: at(1),
      pricing: customPricing,
      addonsCatalog: CUE_M1.addons,
    });
    expect(q.totalCents).toBe(9900);
  });

  it("includes the room label in the space line item", () => {
    const q = calculateQuote({
      startsAt: at(0),
      endsAt: at(2),
      pricing: CUE_M2.pricing,
      addonsCatalog: CUE_M2.addons,
      roomLabel: CUE_M2.shortTitle,
    });
    expect(q.lineItems[0].label).toBe("M2 · 2h × $125.00");
  });
});

describe("minimum booking enforcement (no 3-hour minimum)", () => {
  it("calculateQuote rejects a 30-minute booking on a 1h-minimum room", () => {
    expect(() =>
      calculateQuote({
        startsAt: at(0),
        endsAt: new Date(at(0).getTime() + 30 * 60 * 1000),
        pricing: CUE_M1.pricing,
        addonsCatalog: CUE_M1.addons,
      })
    ).toThrow("Minimum booking is 1 hour.");
  });

  it("createQuoteForSpace rejects a 30-minute booking with a 400", async () => {
    const result = await createQuoteForSpace(
      IDS.m1,
      at(0),
      new Date(at(0).getTime() + 30 * 60 * 1000)
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe("Minimum booking is 1 hour.");
    }
  });

  it("createBookingRequest rejects a 30-minute booking with a 400 and stores nothing", async () => {
    const result = await createBookingRequest({
      spaceId: IDS.m1,
      startsAt: at(0).toISOString(),
      endsAt: new Date(at(0).getTime() + 30 * 60 * 1000).toISOString(),
      guest: { name: "Guest", email: "guest-30min@example.com" },
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(400);
    }
    expect("booking" in result).toBe(false);
  });

  it("raising min_hours to 2 rejects a 1-hour booking", () => {
    const pricing = { ...CUE_M1.pricing, minHours: 2 };
    expect(() =>
      calculateQuote({
        startsAt: at(0),
        endsAt: at(1),
        pricing,
        addonsCatalog: CUE_M1.addons,
      })
    ).toThrow("Minimum booking is 2 hours.");
  });

  it("1-hour booking is accepted at the default min_hours of 1", () => {
    const q = calculateQuote({
      startsAt: at(0),
      endsAt: at(1),
      pricing: CUE_M1.pricing,
      addonsCatalog: CUE_M1.addons,
    });
    expect(q.totalCents).toBe(7000);
  });
});
