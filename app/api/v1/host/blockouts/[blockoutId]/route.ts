import { NextRequest } from "next/server";
import { requireHost } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { getStore, isDemoMode } from "@/lib/store";
import { query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ blockoutId: string }> }
) {
  const auth = requireHost(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const { blockoutId } = await ctx.params;

  if (isDemoMode()) {
    const ok = getStore().deleteBlockout(blockoutId);
    if (!ok) return jsonError(404, "not_found", "Blockout not found");
    return new NextResponse(null, { status: 204 });
  }

  const { rowCount } = await query(`DELETE FROM blockouts WHERE id = $1`, [
    blockoutId,
  ]);
  if (!rowCount) return jsonError(404, "not_found", "Blockout not found");
  return new NextResponse(null, { status: 204 });
}
