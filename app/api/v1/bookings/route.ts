import { NextRequest } from "next/server";
import { createBookingRequest } from "@/lib/bookings";
import { jsonError, jsonOk } from "@/lib/http";

export async function POST(req: NextRequest) {
  let body: {
    spaceId?: string;
    startsAt?: string;
    endsAt?: string;
    addons?: { addonId: string; quantity?: number; meta?: Record<string, unknown> }[];
    guestNotes?: string;
    activityDescription?: string;
    guest?: { name: string; email: string; phone?: string };
  };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }
  if (!body.spaceId || !body.startsAt || !body.endsAt || !body.guest?.name || !body.guest?.email) {
    return jsonError(400, "bad_request", "spaceId, startsAt, endsAt, and guest are required");
  }
  try {
    const result = await createBookingRequest({
      spaceId: body.spaceId,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      addons: body.addons,
      guestNotes: body.guestNotes,
      activityDescription: body.activityDescription,
      guest: body.guest,
    });
    if ("error" in result && result.error) {
      const status = "status" in result && typeof result.status === "number" ? result.status : 400;
      return jsonError(status, String(result.error), String(result.message));
    }
    return jsonOk(result, 201);
  } catch (err) {
    console.error("POST /api/v1/bookings failed", err);
    const message = err instanceof Error ? err.message : "Internal booking error";
    return jsonError(500, "internal_error", message);
  }
}
