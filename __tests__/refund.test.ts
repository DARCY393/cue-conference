import { describe, expect, it } from "vitest";
import {
  calculateCancellationRefund,
  CANCELLATION_DEFAULT,
} from "../lib/refund";

const rules = CANCELLATION_DEFAULT;

describe("calculateCancellationRefund", () => {
  const startsAt = new Date("2026-09-20T15:00:00.000Z");
  const totalCents = 20000;

  it("full refund when captured and more than 48h before start", () => {
    const now = new Date("2026-09-17T15:00:00.000Z"); // 3 days before
    const r = calculateCancellationRefund({ now, startsAt, totalCents, captured: true, rules });
    expect(r.action).toBe("refund");
    expect(r.refundCents).toBe(20000);
  });

  it("exactly 48h before start is still free (boundary)", () => {
    const now = new Date("2026-09-18T15:00:00.000Z"); // exactly 48h before
    const r = calculateCancellationRefund({ now, startsAt, totalCents, captured: true, rules });
    expect(r.action).toBe("refund");
    expect(r.refundCents).toBe(20000);
  });

  it("no refund when captured and less than 48h before start", () => {
    const now = new Date("2026-09-19T12:00:00.000Z"); // 27h before
    const r = calculateCancellationRefund({ now, startsAt, totalCents, captured: true, rules });
    expect(r.action).toBe("no_refund");
    expect(r.refundCents).toBe(0);
  });

  it("no refund when cancelling after start has already passed", () => {
    const now = new Date("2026-09-21T00:00:00.000Z"); // after start
    const r = calculateCancellationRefund({ now, startsAt, totalCents, captured: true, rules });
    expect(r.action).toBe("no_refund");
    expect(r.refundCents).toBe(0);
  });

  it("releases the hold (never a refund) when not yet captured, even ≥48h before start", () => {
    const now = new Date("2026-09-10T15:00:00.000Z"); // 10 days before
    const r = calculateCancellationRefund({ now, startsAt, totalCents, captured: false, rules });
    expect(r.action).toBe("release_hold");
    expect(r.refundCents).toBe(0);
  });

  it("releases the hold rather than keeping captured funds when uncaptured and <48h before start", () => {
    const now = new Date("2026-09-20T10:00:00.000Z"); // 5h before
    const r = calculateCancellationRefund({ now, startsAt, totalCents, captured: false, rules });
    expect(r.action).toBe("release_hold");
    expect(r.refundCents).toBe(0);
  });
});
