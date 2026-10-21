import { NextRequest } from "next/server";
import { createBookingRequest, sanitizeBookingForPublic } from "@/lib/bookings";
import { requestedPagePath } from "@/lib/booking-access";
import { jsonError, jsonOk } from "@/lib/http";

export async function POST(req: NextRequest) {
  let body: {
    spaceId?: string;
    startsAt?: string;
    endsAt?: string;
    /** Calendar date (any ISO instant on that local day) of a multi-day reservation's last day. */
    endDate?: string;
    addons?: { addonId: string; quantity?: number; meta?: Record<string, unknown> }[];
    /** Reserved parking passes under the building (0-20, integer); re-validated server-side. */
    parkingPasses?: number;
    guestNotes?: string;
    activityDescription?: string;
    guest?: { name: string; email: string; phone?: string };
    /** Per-submission idempotency key from the browser (8-64 chars, [A-Za-z0-9_-]). */
    clientRequestKey?: string;
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
      endDate: body.endDate,
      addons: body.addons,
      parkingPasses: body.parkingPasses,
      guestNotes: body.guestNotes,
      activityDescription: body.activityDescription,
      guest: body.guest,
      clientRequestKey: body.clientRequestKey,
    });
    if (!("booking" in result)) {
      return jsonError(result.status, result.error, result.message);
    }
    return jsonOk(
      {
        ...result,
        booking: sanitizeBookingForPublic(result.booking),
        // Demo mode authorizes immediately; real checkouts get this from /authorize instead.
        confirmationUrl: result.booking.status === "requested" ? requestedPagePath(result.booking.id) : undefined,
      },
      201
    );
  } catch (err) {
    console.error("POST /api/v1/bookings failed", err);
    const message = err instanceof Error ? err.message : "Internal booking error";
    return jsonError(500, "internal_error", message);
  }
}
