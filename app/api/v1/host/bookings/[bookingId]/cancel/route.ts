import { NextRequest } from "next/server";
import { cancelBooking, getBookingById, sanitizeBookingForApi } from "@/lib/bookings";
import { previewCancellation } from "@/lib/cancellation";
import { getSpaceById } from "@/lib/space-service";
import { requireStaff } from "@/lib/staff-auth";
import { jsonError, jsonOk } from "@/lib/http";

/** Staff: what cancelling would do right now (policy refund, and the courtesy full-refund amount). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> }
) {
  const auth = await requireStaff(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const { bookingId } = await ctx.params;
  const booking = await getBookingById(bookingId);
  if (!booking) return jsonError(404, "not_found", "Booking not found");
  const space = await getSpaceById(booking.spaceId);
  const rules = space?.cancellationPolicy?.rules;
  const policy = previewCancellation(booking, { rules, allowStarted: true });
  const courtesy = previewCancellation(booking, { rules, allowStarted: true, courtesyFullRefund: true });
  return jsonOk({ policy, courtesy, totalCents: booking.totalCents, status: booking.status });
}

/** Staff cancel. Body: { courtesyFullRefund?: boolean, reason?: string }. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> }
) {
  const auth = await requireStaff(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const { bookingId } = await ctx.params;
  let body: { courtesyFullRefund?: unknown; reason?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    /* optional */
  }
  const result = await cancelBooking(bookingId, {
    actor: "staff",
    courtesyFullRefund: body.courtesyFullRefund === true,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined,
  });
  if ("error" in result) return jsonError(result.status, result.error, result.message);
  return jsonOk({
    booking: sanitizeBookingForApi(result.booking),
    refundCents: result.refundCents,
    refundId: result.refundId,
    action: result.action,
    alreadyCancelled: Boolean(result.alreadyCancelled),
  });
}
