import { NextRequest } from "next/server";
import { verifyBookingAccessToken } from "@/lib/booking-access";
import { saveParkingRecipients } from "@/lib/parking-recipients";
import { jsonError, jsonOk } from "@/lib/http";

/**
 * Guest saves the parking pass list. Requires the per-booking access token (same HMAC token as
 * the cancel / "Request received" pages); anything else gets the same 404 as an unknown booking.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await ctx.params;
  let body: { token?: unknown; recipients?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    return jsonError(400, "invalid_json", "Invalid JSON body");
  }
  const token = typeof body.token === "string" ? body.token : req.nextUrl.searchParams.get("t");
  if (!verifyBookingAccessToken(bookingId, token)) return jsonError(404, "not_found", "Booking not found");
  const result = await saveParkingRecipients(bookingId, body.recipients);
  if (!result.ok) return jsonError(result.status, result.error, result.message);
  return jsonOk({ recipients: result.recipients });
}
