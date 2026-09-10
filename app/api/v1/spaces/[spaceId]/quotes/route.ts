import { NextRequest } from "next/server";
import { createQuoteForSpace } from "@/lib/bookings";
import { getSpaceById, getSpaceBySlug } from "@/lib/space-service";
import { jsonError, jsonOk } from "@/lib/http";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSpaceId(key: string): Promise<string | null> {
  if (UUID_RE.test(key)) {
    const byId = await getSpaceById(key);
    if (byId) return byId.id;
  }
  const bySlug = await getSpaceBySlug(key);
  return bySlug?.id ?? null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId: key } = await ctx.params;
  let body: { startsAt?: string; endsAt?: string; addons?: { addonId: string; quantity?: number }[] };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }
  if (!body.startsAt || !body.endsAt) {
    return jsonError(400, "bad_request", "startsAt and endsAt are required");
  }
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return jsonError(400, "bad_request", "Invalid dates");
  }
  const spaceId = await resolveSpaceId(key);
  if (!spaceId) return jsonError(404, "not_found", "Space not found");
  const result = await createQuoteForSpace(spaceId, startsAt, endsAt, body.addons);
  if (!result.ok) {
    return jsonError(result.status, result.error, result.message);
  }
  return jsonOk(result.quote);
}
