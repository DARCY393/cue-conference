import { NextRequest } from "next/server";
import { markParkingIssued } from "@/lib/parking-recipients";
import { requireStaff } from "@/lib/staff-auth";
import { jsonError, jsonOk } from "@/lib/http";

/** Staff: mark this booking's parking passes issued (in Parkonect), or `{ issued: false }` to undo. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ bookingId: string }> }) {
  const auth = await requireStaff(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const { bookingId } = await ctx.params;
  let body: { issued?: unknown; note?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    /* optional body */
  }
  const staff = auth.staff;
  const result = await markParkingIssued(bookingId, {
    issued: body.issued !== false,
    by: staff.email || "staff",
    note: typeof body.note === "string" ? body.note : undefined,
  });
  if (!result.ok) return jsonError(result.status, result.error, result.message);
  return jsonOk({ issuedAt: result.meta.issuedAt ?? null, issuedBy: result.meta.issuedBy ?? null });
}
