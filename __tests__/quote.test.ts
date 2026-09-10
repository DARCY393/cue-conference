import { describe, expect, it } from "vitest";
import { calculateQuote, calculateOvertimeCents, calendarDaysSpanned } from "../lib/quote";
import { CUE_SPACE } from "../lib/seed";

const pricing = CUE_SPACE.pricing;
const addons = CUE_SPACE.addons;

describe("calculateQuote", () => {
  it("prices a 2-hour booking at $70/hr", () => {
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

  it("applies 20% long-booking discount at 8+ hours", () => {
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

  it("adds parking per day", () => {
    const startsAt = new Date("2026-09-14T14:00:00.000Z");
    const endsAt = new Date("2026-09-14T16:00:00.000Z");
    const q = calculateQuote({
      startsAt,
      endsAt,
      pricing,
      addonsCatalog: addons,
      addonSelections: [{ addonId: addons[0].id, quantity: 1 }],
    });
    expect(q.addonsCents).toBe(2500);
    expect(q.totalCents).toBe(16500);
  });

  it("rejects below min hours", () => {
    expect(() =>
      calculateQuote({
        startsAt: new Date("2026-09-14T14:00:00.000Z"),
        endsAt: new Date("2026-09-14T14:30:00.000Z"),
        pricing,
        addonsCatalog: addons,
      })
    ).toThrow(/Minimum/);
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
