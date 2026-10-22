import { NextRequest } from "next/server";
import { cancelBooking, sanitizeBookingForApi, sanitizeBookingForPublic } from "@/lib/bookings";
import { verifyBookingAccessToken } from "@/lib/booking-access";
import { requireStaff } from "@/lib/staff-auth";
import { jsonError, jsonOk } from "@/lib/http";

/**
 * Cancel a booking. Requires either:
 * - the guest's per-booking access token (`token` in the JSON body, or `?t=`), the same HMAC token
 *   as the "Request received" page, compared in constant time; or
 * - a signed-in staff session (staff may also pass `courtesyFullRefund: true`).
 * Anything else gets the same 404 as an unknown booking id, so nothing about the booking leaks.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await ctx.params;
  let body: { token?: unknown; reason?: unknown; courtesyFullRefund?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    /* optional body */
  }
  const token =
    (typeof body.token === "string" ? body.token : null) ?? req.nextUrl.searchParams.get("t");
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;

  let actor: "guest" | "staff" | null = null;
  if (token && verifyBookingAccessToken(bookingId, token)) {
    actor = "guest";
  } else {
    const staff = await requireStaff(req);
    if (staff.ok) actor = "staff";
  }
  if (!actor) return jsonError(404, "not_found", "Booking not found");

  const result = await cancelBooking(bookingId, {
    actor,
    reason,
    courtesyFullRefund: actor === "staff" && body.courtesyFullRefund === true,
  });
  if ("error" in result) {
    return jsonError(result.status, result.error, result.message);
  }
  const booking =
    actor === "staff" ? sanitizeBookingForApi(result.booking) : sanitizeBookingForPublic(result.booking);
  return jsonOk({
    booking,
    refundCents: result.refundCents,
    action: result.action,
    alreadyCancelled: Boolean(result.alreadyCancelled),
    ...(actor === "staff" && result.refundId ? { refundId: result.refundId } : {}),
  });
}
