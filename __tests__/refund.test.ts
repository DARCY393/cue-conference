import { describe, expect, it } from "vitest";
import {
  calculateFlexibleRefund,
  FLEXIBLE_DEFAULT,
} from "../lib/refund";

const rules = FLEXIBLE_DEFAULT;

describe("calculateFlexibleRefund", () => {
  const confirmedAt = new Date("2026-09-01T12:00:00.000Z");
  const startsAt = new Date("2026-09-20T15:00:00.000Z"); // ~19 days later
  const totalCents = 20000;
  const feesCents = 2000;

  it("grace full refund within 24h of confirm when start ≥48h away", () => {
    const now = new Date("2026-09-01T18:00:00.000Z"); // 6h after confirm
    const r = calculateFlexibleRefund({
      now,
      startsAt,
      confirmedAt,
      totalCents,
      feesCents,
      rules,
    });
    expect(r.tier).toBe("grace_full");
    expect(r.refundCents).toBe(20000);
  });

  it("full refund when ≥7 days before start", () => {
    const now = new Date("2026-09-10T12:00:00.000Z"); // 10 days before
    // outside grace (confirmed Sep 1)
    const r = calculateFlexibleRefund({
      now,
      startsAt,
      confirmedAt,
      totalCents,
      feesCents,
      rules,
    });
    expect(r.tier).toBe("full");
    expect(r.refundCents).toBe(20000);
  });

  it("partial 50% excluding fees when ≥24h and <7 days", () => {
    const now = new Date("2026-09-18T12:00:00.000Z"); // ~2 days before
    const r = calculateFlexibleRefund({
      now,
      startsAt,
      confirmedAt,
      totalCents,
      feesCents,
      rules,
    });
    expect(r.tier).toBe("partial");
    // 50% of (20000-2000) = 9000
    expect(r.refundCents).toBe(9000);
  });

  it("no refund when <24h before start", () => {
    const now = new Date("2026-09-20T10:00:00.000Z"); // 5h before
    const r = calculateFlexibleRefund({
      now,
      startsAt,
      confirmedAt,
      totalCents,
      feesCents,
      rules,
    });
    expect(r.tier).toBe("none");
    expect(r.refundCents).toBe(0);
  });

  it("grace does not apply if start is <48h away", () => {
    const nearStart = new Date("2026-09-20T10:00:00.000Z");
    const justConfirmed = new Date("2026-09-20T08:00:00.000Z");
    const now = new Date("2026-09-20T09:00:00.000Z");
    const r = calculateFlexibleRefund({
      now,
      startsAt: nearStart,
      confirmedAt: justConfirmed,
      totalCents,
      feesCents,
      rules,
    });
    expect(r.tier).toBe("none");
  });
});
