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

describe("long-booking discount (20% off at 8+ total billable hours, on by default)", () => {
  it("M1 8h same-day gets 20% off: base $560, discount $112, total $448", async () => {
    const result = await createQuoteForSpace(IDS.m1, at(0), at(8));
    if (!result.ok) throw new Error(`expected ok quote, got ${result.error}: ${result.message}`);
    expect(result.quote.hours).toBe(8);
    expect(result.quote.baseCents).toBe(56000);
    expect(result.quote.discountCents).toBe(11200);
    expect(result.quote.totalCents).toBe(44800);
  });

  it("M1 7h same-day gets no discount", async () => {
    const result = await createQuoteForSpace(IDS.m1, at(0), at(7));
    if (!result.ok) throw new Error(`expected ok quote, got ${result.error}: ${result.message}`);
    expect(result.quote.hours).toBe(7);
    expect(result.quote.discountCents).toBe(0);
    expect(result.quote.totalCents).toBe(49000);
  });

  it("M2 8h gets 20% off: base $1000, discount $200, total $800", async () => {
    const result = await createQuoteForSpace(IDS.m2, at(0), at(8));
    if (!result.ok) throw new Error(`expected ok quote, got ${result.error}: ${result.message}`);
    expect(result.quote.baseCents).toBe(100000);
    expect(result.quote.discountCents).toBe(20000);
    expect(result.quote.totalCents).toBe(80000);
    expect(result.quote.lineItems.some((li) => li.code === "discount_long_booking")).toBe(true);
  });

  it("can be kill-switched off via PRICING_ENABLE_LONG_BOOKING_DISCOUNT=false", () => {
    const q = calculateQuote({
      startsAt: at(0),
      endsAt: at(8),
      pricing: CUE_M1.pricing,
      addonsCatalog: CUE_M1.addons,
      features: { longBookingDiscount: false },
    });
    expect(q.discountCents).toBe(0);
    expect(q.totalCents).toBe(56000);
  });
});

describe("multi-day reservations (one daily window per bookable weekday)", () => {
  it("3 days x 3h = 9h total gets 20% off the full base", async () => {
    // Mon 9:00-12:00 through Wed 9:00-12:00 (endDate = any instant on Wed).
    const result = await createQuoteForSpace(IDS.m1, at(0), at(3), undefined, at(48));
    if (!result.ok) throw new Error(`expected ok quote, got ${result.error}: ${result.message}`);
    expect(result.quote.hours).toBe(9);
    expect(result.quote.baseCents).toBe(63000); // 9h x $70
    expect(result.quote.discountCents).toBe(12600); // 20%
    expect(result.quote.totalCents).toBe(50400);
  });

  it("2 days x 3h = 6h total gets no discount", async () => {
    const result = await createQuoteForSpace(IDS.m1, at(0), at(3), undefined, at(24));
    if (!result.ok) throw new Error(`expected ok quote, got ${result.error}: ${result.message}`);
    expect(result.quote.hours).toBe(6);
    expect(result.quote.discountCents).toBe(0);
    expect(result.quote.totalCents).toBe(42000);
  });

  it("skips the weekend gap: Fri 9-12 through Mon 9-12 bills only Fri + Mon (6h), not 4 calendar days", async () => {
    // at(96) from Mon 9am lands on Friday 9am the same week.
    const friStart = at(96);
    const friEnd = at(99);
    const monEnd = at(96 + 72); // following Monday
    const result = await createQuoteForSpace(IDS.m1, friStart, friEnd, undefined, monEnd);
    if (!result.ok) throw new Error(`expected ok quote, got ${result.error}: ${result.message}`);
    expect(result.quote.hours).toBe(6);
  });

  it("stores the booking's startsAt/endsAt as first-day-start to last-day-end", async () => {
    const created = await createBookingRequest({
      spaceId: IDS.m1,
      startsAt: at(0).toISOString(),
      endsAt: at(3).toISOString(),
      endDate: at(48).toISOString(),
      guest: { name: "Multi Day Guest", email: "multiday@example.com" },
    });
    if (!("booking" in created)) throw new Error("expected a booking");
    expect(new Date(created.booking.startsAt).getTime()).toBe(at(0).getTime());
    // Last day (Wed) ends at 12:00 Chicago, i.e. 48h + 3h from Mon 9:00.
    expect(new Date(created.booking.endsAt).getTime()).toBe(at(51).getTime());
    expect(created.booking.totalCents).toBe(50400);
  });
});
