import { NextRequest } from "next/server";
import { acceptBooking, sanitizeBookingForApi } from "@/lib/bookings";
import { requireHost } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> }
) {
  const auth = requireHost(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const { bookingId } = await ctx.params;
  const result = await acceptBooking(bookingId);
  if ("booking" in result && result.booking) {
    const booking = sanitizeBookingForApi(result.booking);
    return jsonOk(
      result.calendarSyncWarning
        ? { ...booking, calendarSyncWarning: result.calendarSyncWarning }
        : booking
    );
  }
  const err = result as { error: string; message: string; status: number };
  return jsonError(err.status, err.error, err.message);
}
