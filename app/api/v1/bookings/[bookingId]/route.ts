import { NextRequest } from "next/server";
import { getBookingById } from "@/lib/bookings";
import { jsonError, jsonOk } from "@/lib/http";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await ctx.params;
  const booking = await getBookingById(bookingId);
  if (!booking) return jsonError(404, "not_found", "Booking not found");
  return jsonOk(booking);
}
