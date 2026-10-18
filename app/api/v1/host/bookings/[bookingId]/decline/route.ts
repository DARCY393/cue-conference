import { NextRequest } from "next/server";
import { declineBooking, sanitizeBookingForApi } from "@/lib/bookings";
import { requireHost } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> }
) {
  const auth = requireHost(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const { bookingId } = await ctx.params;
  let reason: string | undefined;
  try {
    const body = await req.json();
    reason = body?.reason;
  } catch {
    /* optional */
  }
  const result = await declineBooking(bookingId, reason);
  if ("booking" in result && result.booking) {
    return jsonOk(sanitizeBookingForApi(result.booking));
  }
  const err = result as { error: string; message: string; status: number };
  return jsonError(err.status, err.error, err.message);
}
