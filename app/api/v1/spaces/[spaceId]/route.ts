import { NextRequest } from "next/server";
import { getSpaceBySlug, getSpaceById } from "@/lib/space-service";
import { toPublicSpaceJson } from "@/lib/space-public";
import { jsonError, jsonOk } from "@/lib/http";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId: key } = await ctx.params;
  const space = UUID_RE.test(key)
    ? (await getSpaceById(key)) || (await getSpaceBySlug(key))
    : await getSpaceBySlug(key);
  if (!space) return jsonError(404, "not_found", "Space not found");
  return jsonOk(toPublicSpaceJson(space));
}
