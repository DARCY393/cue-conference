import { NextRequest } from "next/server";
import { getBusy, getSpaceById, getSpaceBySlug } from "@/lib/space-service";
import { jsonError, jsonOk } from "@/lib/http";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSpace(key: string) {
  if (UUID_RE.test(key)) {
    return (await getSpaceById(key)) || (await getSpaceBySlug(key));
  }
  return getSpaceBySlug(key);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId: key } = await ctx.params;
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) {
    return jsonError(400, "bad_request", "from and to query params are required");
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate <= fromDate) {
    return jsonError(400, "bad_request", "Invalid from/to range");
  }
  const space = await resolveSpace(key);
  if (!space) return jsonError(404, "not_found", "Space not found");
  const busy = await getBusy(space.id, fromDate, toDate);
  return jsonOk({
    spaceId: space.id,
    timezone: space.timezone,
    busy,
  });
}
