import type { FlexibleRules } from "./types";

export interface RefundInput {
  now: Date;
  startsAt: Date;
  /** When the booking was accepted / confirmed (decidedAt). */
  confirmedAt: Date;
  totalCents: number;
  feesCents: number;
  rules: FlexibleRules;
}

export interface RefundResult {
  refundCents: number;
  tier: "grace_full" | "full" | "partial" | "none";
  reason: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Flexible cancellation refund calculator.
 *
 * Priority:
 * 1. Grace: within grace_hours_after_confirm of confirm AND start is still
 *    grace_requires_hours_before_start away → 100% of total
 * 2. Full: cancelled at least full_refund_days_before days before start → 100%
 * 3. Partial: cancelled at least partial_refund_hours_before hours before start
 *    → partial_refund_bps of (total − fees if partial_excludes_fees else total)
 * 4. Else → 0
 */
export function calculateFlexibleRefund(input: RefundInput): RefundResult {
  const { now, startsAt, confirmedAt, totalCents, feesCents, rules } = input;

  if (totalCents < 0 || feesCents < 0 || feesCents > totalCents) {
    throw new Error("Invalid money amounts");
  }

  const hoursAfterConfirm = (now.getTime() - confirmedAt.getTime()) / HOUR_MS;
  const hoursBeforeStart = (startsAt.getTime() - now.getTime()) / HOUR_MS;
  const daysBeforeStart = (startsAt.getTime() - now.getTime()) / DAY_MS;

  if (
    hoursAfterConfirm >= 0 &&
    hoursAfterConfirm <= rules.grace_hours_after_confirm &&
    hoursBeforeStart >= rules.grace_requires_hours_before_start
  ) {
    return {
      refundCents: totalCents,
      tier: "grace_full",
      reason: `Grace period: cancelled within ${rules.grace_hours_after_confirm}h of confirmation with ≥${rules.grace_requires_hours_before_start}h until start`,
    };
  }

  if (daysBeforeStart >= rules.full_refund_days_before) {
    return {
      refundCents: totalCents,
      tier: "full",
      reason: `Full refund: ≥${rules.full_refund_days_before} days before start`,
    };
  }

  if (hoursBeforeStart >= rules.partial_refund_hours_before) {
    const base = rules.partial_excludes_fees
      ? Math.max(0, totalCents - feesCents)
      : totalCents;
    const refundCents = Math.floor((base * rules.partial_refund_bps) / 10000);
    return {
      refundCents,
      tier: "partial",
      reason: `Partial refund (${rules.partial_refund_bps / 100}%) with ≥${rules.partial_refund_hours_before}h before start`,
    };
  }

  return {
    refundCents: 0,
    tier: "none",
    reason: `No refund: less than ${rules.partial_refund_hours_before}h before start`,
  };
}

export const FLEXIBLE_DEFAULT: FlexibleRules = {
  full_refund_days_before: 7,
  partial_refund_hours_before: 24,
  partial_refund_bps: 5000,
  partial_excludes_fees: true,
  grace_hours_after_confirm: 24,
  grace_requires_hours_before_start: 48,
};
