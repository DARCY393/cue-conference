import { NextRequest } from "next/server";
import { cancelBooking } from "@/lib/bookings";
import { jsonError, jsonOk } from "@/lib/http";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await ctx.params;
  let reason: string | undefined;
  try {
    const body = await req.json();
    reason = body?.reason;
  } catch {
    /* optional body */
  }
  const result = await cancelBooking(bookingId, reason);
  if ("error" in result) {
    return jsonError(result.status, result.error, result.message);
  }
  return jsonOk(result);
}
