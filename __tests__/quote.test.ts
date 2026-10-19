import { describe, expect, it } from "vitest";
import { calculateQuote, calculateOvertimeCents, calendarDaysSpanned } from "../lib/quote";
import { CUE_SPACE, LEGACY_PARKING_ADDON } from "../lib/seed";

const pricing = CUE_SPACE.pricing;
const addons = CUE_SPACE.addons;

// Parking is still removed from the default catalog (off by default); see
// docs/REMOVED_FEATURES.md. The long-booking discount, by contrast, is on by
// default — CUE_SPACE.pricing already carries longBookingDiscountBps = 2000.
const parkingAddons = [LEGACY_PARKING_ADDON];

describe("calculateQuote", () => {
  it("prices a 2-hour booking at $70/hr (below the 8h discount threshold)", () => {
    const startsAt = new Date("2026-09-14T14:00:00.000Z"); // Mon
    const endsAt = new Date("2026-09-14T16:00:00.000Z");
    const q = calculateQuote({
      startsAt,
      endsAt,
      pricing,
      addonsCatalog: addons,
    });
    expect(q.hours).toBe(2);
    expect(q.baseCents).toBe(14000);
    expect(q.discountCents).toBe(0);
    expect(q.totalCents).toBe(14000);
  });

  it("applies the 20% long-booking discount at 8+ hours by default", () => {
    const startsAt = new Date("2026-09-14T14:00:00.000Z");
    const endsAt = new Date("2026-09-14T22:00:00.000Z"); // 8h
    const q = calculateQuote({
      startsAt,
      endsAt,
      pricing,
      addonsCatalog: addons,
    });
    expect(q.hours).toBe(8);
    expect(q.baseCents).toBe(56000);
    expect(q.discountCents).toBe(11200); // 20%
    expect(q.totalCents).toBe(44800);
  });

  it("can still be force-disabled via an explicit feature-flag override", () => {
    const startsAt = new Date("2026-09-14T14:00:00.000Z");
    const endsAt = new Date("2026-09-14T22:00:00.000Z"); // 8h
    const q = calculateQuote({
      startsAt,
      endsAt,
      pricing,
      addonsCatalog: addons,
      features: { longBookingDiscount: false },
    });
    expect(q.discountCents).toBe(0);
    expect(q.totalCents).toBe(56000);
  });

  it("adds parking per day (still opt-in via the legacy addon fixture)", () => {
    const startsAt = new Date("2026-09-14T14:00:00.000Z");
    const endsAt = new Date("2026-09-14T16:00:00.000Z");
    const q = calculateQuote({
      startsAt,
      endsAt,
      pricing,
      addonsCatalog: parkingAddons,
      addonSelections: [{ addonId: parkingAddons[0].id, quantity: 1 }],
    });
    expect(q.addonsCents).toBe(2500);
    expect(q.totalCents).toBe(16500);
  });

  it("rejects below min hours with a generic message (current 1h-minimum default)", () => {
    expect(() =>
      calculateQuote({
        startsAt: new Date("2026-09-14T14:00:00.000Z"),
        endsAt: new Date("2026-09-14T14:30:00.000Z"),
        pricing,
        addonsCatalog: addons,
      })
    ).toThrow("Minimum booking is 1 hour.");
  });
});

describe("calculateOvertimeCents", () => {
  it("bills 30 min at 1.5x", () => {
    expect(calculateOvertimeCents(30, 7000, 1.5)).toBe(5250);
  });
  it("bills 60 min at 1.5x", () => {
    expect(calculateOvertimeCents(60, 7000, 1.5)).toBe(10500);
  });
});

describe("calendarDaysSpanned", () => {
  it("is 1 for same-day half-open window", () => {
    expect(
      calendarDaysSpanned(
        new Date("2026-09-14T14:00:00.000Z"),
        new Date("2026-09-14T22:00:00.000Z")
      )
    ).toBe(1);
  });
});
