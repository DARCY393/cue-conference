import type { CancellationRules } from "./types";

export interface RefundInput {
  now: Date;
  startsAt: Date;
  totalCents: number;
  /** Was the hold ever captured, i.e. did staff accept before the guest cancelled? */
  captured: boolean;
  rules: CancellationRules;
}

export type CancellationAction = "release_hold" | "refund" | "no_refund";

export interface RefundResult {
  refundCents: number;
  action: CancellationAction;
  reason: string;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Standard cancellation policy (non-member bookings): free cancellation up to
 * `free_cancellation_hours_before` hours before start; no refund after that.
 *
 * The hold-vs-capture distinction matters independently of that cutoff: an
 * uncaptured PaymentIntent never actually charged the guest, so "no refund"
 * there means releasing the authorization hold, not keeping captured funds.
 * Priority:
 * 1. Not captured (staff never accepted) → release the hold. Nothing was
 *    charged, so there's nothing to refund either way.
 * 2. Captured and ≥ free_cancellation_hours_before away → full refund.
 * 3. Captured and inside the window → no refund.
 */
export function calculateCancellationRefund(input: RefundInput): RefundResult {
  const { now, startsAt, totalCents, captured, rules } = input;

  if (totalCents < 0) {
    throw new Error("Invalid money amount");
  }

  if (!captured) {
    return {
      refundCents: 0,
      action: "release_hold",
      reason: "Booking was never accepted — releasing the uncaptured payment hold.",
    };
  }

  const hoursBeforeStart = (startsAt.getTime() - now.getTime()) / HOUR_MS;
  if (hoursBeforeStart >= rules.free_cancellation_hours_before) {
    return {
      refundCents: totalCents,
      action: "refund",
      reason: `Free cancellation: ≥${rules.free_cancellation_hours_before}h before start.`,
    };
  }

  return {
    refundCents: 0,
    action: "no_refund",
    reason: `No refund: less than ${rules.free_cancellation_hours_before}h before start.`,
  };
}

export const CANCELLATION_DEFAULT: CancellationRules = {
  free_cancellation_hours_before: 48,
};
