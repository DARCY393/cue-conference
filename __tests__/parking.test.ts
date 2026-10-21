import { describe, expect, it } from "vitest";
import { calculateQuote, PARKING_RATE_CENTS, validateParkingPasses } from "../lib/quote";
import { CUE_SPACE } from "../lib/seed";

const pricing = CUE_SPACE.pricing;
const addons = CUE_SPACE.addons;

describe("parking pricing", () => {
  it("$20/person/day, no discount applied below the 8h threshold", () => {
    const startsAt = new Date("2026-09-14T14:00:00.000Z"); // Mon
    const endsAt = new Date("2026-09-14T16:00:00.000Z"); // 2h, 1 day
    const q = calculateQuote({
      startsAt,
      endsAt,
      pricing,
      addonsCatalog: addons,
      parkingPasses: 2,
    });
    expect(q.parkingPasses).toBe(2);
    expect(q.parkingCents).toBe(2 * 1 * PARKING_RATE_CENTS); // 4000
    expect(q.totalCents).toBe(q.baseCents + q.parkingCents);
    expect(q.lineItems.find((li) => li.code === "parking")?.amountCents).toBe(4000);
  });

  it("is excluded from the 20% long-booking discount at 8+ hours", () => {
    const startsAt = new Date("2026-09-14T14:00:00.000Z");
    const endsAt = new Date("2026-09-14T22:00:00.000Z"); // 8h, 1 day
    const q = calculateQuote({
      startsAt,
      endsAt,
      pricing,
      addonsCatalog: addons,
      parkingPasses: 1,
    });
    expect(q.discountCents).toBeGreaterThan(0); // the room discount still applies
    expect(q.parkingCents).toBe(1 * 1 * PARKING_RATE_CENTS); // undiscounted
    expect(q.totalCents).toBe(q.baseCents - q.discountCents + q.parkingCents);
  });

  it("charges parking for every distinct calendar day spanned by a multi-day reservation", () => {
    // Monday 14:00 through Wednesday 16:00 — 3 distinct calendar days.
    const startsAt = new Date("2026-09-14T14:00:00.000Z");
    const endsAt = new Date("2026-09-16T16:00:00.000Z");
    const q = calculateQuote({
      startsAt,
      endsAt,
      pricing,
      addonsCatalog: addons,
      parkingPasses: 2,
      totalHours: 8, // billable hours computed separately by the caller; irrelevant to parking days
    });
    expect(q.parkingCents).toBe(2 * 3 * PARKING_RATE_CENTS); // 12000
  });

  it("defaults to 0 passes when omitted", () => {
    const q = calculateQuote({
      startsAt: new Date("2026-09-14T14:00:00.000Z"),
      endsAt: new Date("2026-09-14T15:00:00.000Z"),
      pricing,
      addonsCatalog: addons,
    });
    expect(q.parkingPasses).toBe(0);
    expect(q.parkingCents).toBe(0);
    expect(q.lineItems.find((li) => li.code === "parking")).toBeUndefined();
  });

  it("rejects non-integer or out-of-range pass counts", () => {
    const base = {
      startsAt: new Date("2026-09-14T14:00:00.000Z"),
      endsAt: new Date("2026-09-14T15:00:00.000Z"),
      pricing,
      addonsCatalog: addons,
    };
    expect(() => calculateQuote({ ...base, parkingPasses: -1 })).toThrow();
    expect(() => calculateQuote({ ...base, parkingPasses: 21 })).toThrow();
    expect(() => calculateQuote({ ...base, parkingPasses: 1.5 })).toThrow();
  });
});

describe("validateParkingPasses", () => {
  it("treats undefined/null as 0", () => {
    expect(validateParkingPasses(undefined)).toBe(0);
    expect(validateParkingPasses(null)).toBe(0);
  });
  it("accepts the full 0-20 range", () => {
    expect(validateParkingPasses(0)).toBe(0);
    expect(validateParkingPasses(20)).toBe(20);
  });
  it("throws outside the range or on non-integers", () => {
    expect(() => validateParkingPasses(-1)).toThrow();
    expect(() => validateParkingPasses(21)).toThrow();
    expect(() => validateParkingPasses(2.5)).toThrow();
  });
});
