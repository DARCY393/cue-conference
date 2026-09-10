import { NextRequest } from "next/server";
import { chargeOvertime } from "@/lib/bookings";
import { requireHost } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> }
) {
  const auth = requireHost(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const { bookingId } = await ctx.params;
  let body: { extraMinutes?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }
  if (!body.extraMinutes) {
    return jsonError(400, "bad_request", "extraMinutes is required");
  }
  const result = await chargeOvertime(bookingId, body.extraMinutes, body.note);
  if ("amountCents" in result) {
    return jsonOk(result, 201);
  }
  const err = result as { error: string; message: string; status: number };
  return jsonError(err.status, err.error, err.message);
}
