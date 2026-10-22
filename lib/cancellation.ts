/**
 * Client-safe cancellation outcome preview, shared by the guest cancel page and the host screen.
 * The server (cancelBooking in lib/bookings.ts) is the source of truth for what actually happens.
 */
import { calculateCancellationRefund, CANCELLATION_DEFAULT, type CancellationAction } from "./refund";
import type { CancellationRules } from "./types";

export interface CancellationPreview {
  cancellable: boolean;
  action?: CancellationAction;
  refundCents: number;
  /** Short guest-facing description of the outcome. */
  summary: string;
  /** Why it can't be cancelled (when cancellable is false). */
  blockedReason?: "already_cancelled" | "not_active" | "started";
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function cancellationOutcomeText(action: CancellationAction, refundCents: number): string {
  if (action === "release_hold") return "Your card hold will be released — you were never charged.";
  if (action === "refund") return `Full refund of ${formatUsd(refundCents)} to your card.`;
  return "No refund — this booking starts in less than 48 hours.";
}

export function previewCancellation(
  booking: { status: string; startsAt: string; totalCents: number },
  opts: { now?: Date; rules?: CancellationRules | null; courtesyFullRefund?: boolean; allowStarted?: boolean } = {}
): CancellationPreview {
  const now = opts.now ?? new Date();
  if (booking.status === "cancelled") {
    return { cancellable: false, refundCents: 0, summary: "This booking is already cancelled.", blockedReason: "already_cancelled" };
  }
  if (booking.status !== "requested" && booking.status !== "accepted") {
    return { cancellable: false, refundCents: 0, summary: "This booking is no longer active.", blockedReason: "not_active" };
  }
  if (!opts.allowStarted && new Date(booking.startsAt).getTime() <= now.getTime()) {
    return { cancellable: false, refundCents: 0, summary: "This booking has already started.", blockedReason: "started" };
  }
  const captured = booking.status === "accepted";
  let r = calculateCancellationRefund({
    now,
    startsAt: new Date(booking.startsAt),
    totalCents: booking.totalCents,
    captured,
    rules: opts.rules ?? CANCELLATION_DEFAULT,
  });
  if (captured && opts.courtesyFullRefund) {
    r = { refundCents: booking.totalCents, action: "refund", reason: "Courtesy full refund (staff)." };
  }
  return { cancellable: true, action: r.action, refundCents: r.refundCents, summary: cancellationOutcomeText(r.action, r.refundCents) };
}
