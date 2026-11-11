import { NextRequest } from "next/server";
import { verifyBookingAccessToken } from "@/lib/booking-access";
import { saveFeedback } from "@/lib/feedback";
import { jsonError, jsonOk } from "@/lib/http";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await ctx.params;
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError(400, "invalid_json", "Invalid JSON body");
  const token = "token" in body && typeof body.token === "string" ? body.token : null;
  if (!verifyBookingAccessToken(bookingId, token)) return jsonError(404, "not_found", "Booking not found");
  const result = await saveFeedback(bookingId, body, "submit" in body && body.submit === true);
  if (!result.ok) return jsonError(result.status, "invalid_feedback", result.message);
  return jsonOk({ feedback: result.feedback, alertStatus: result.alertStatus });
}
