import { NextRequest } from "next/server";
import { discardDraftBooking } from "@/lib/bookings";
import { jsonError, jsonOk } from "@/lib/http";

/** Guest pressed "Change details" before authorizing: drop the draft and cancel its PaymentIntent. Drafts only. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await ctx.params;
  try {
    const result = await discardDraftBooking(bookingId, "cancelled");
    if (!result.discarded && result.status === undefined) return jsonError(404, "not_found", "Booking not found");
    if (!result.discarded) {
      return jsonError(409, "invalid_status", "This booking was already submitted and can't be discarded here.");
    }
    return jsonOk({ discarded: true });
  } catch (err) {
    console.error("POST /api/v1/bookings/:id/discard failed", err);
    return jsonError(500, "internal_error", "Could not discard the checkout");
  }
}
