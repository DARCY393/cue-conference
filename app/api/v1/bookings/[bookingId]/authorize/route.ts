import { NextRequest } from "next/server";
import { authorizeBooking, sanitizeBookingForPublic } from "@/lib/bookings";
import { jsonError, jsonOk } from "@/lib/http";
import { requestedPagePath } from "@/lib/booking-access";

/**
 * Called by the guest's browser after Stripe confirmPayment succeeds. The server re-checks the
 * PaymentIntent with Stripe; only an authorized hold turns the draft into a request (and sends
 * the guest + host emails). Safe to call repeatedly.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await ctx.params;
  try {
    const result = await authorizeBooking(bookingId);
    if ("error" in result) return jsonError(result.status, result.error, result.message);
    return jsonOk({
      booking: sanitizeBookingForPublic(result.booking),
      alreadyAuthorized: result.alreadyAuthorized,
      // Unguessable link to the guest's "Request received" page (booking id + HMAC token).
      confirmationUrl: requestedPagePath(result.booking.id),
    });
  } catch (err) {
    console.error("POST /api/v1/bookings/:id/authorize failed", err);
    return jsonError(500, "internal_error", "Could not confirm the card hold");
  }
}
