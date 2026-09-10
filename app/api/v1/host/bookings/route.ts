import { NextRequest } from "next/server";
import { listHostBookings } from "@/lib/bookings";
import { requireHost } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";

export async function GET(req: NextRequest) {
  const auth = requireHost(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);

  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const from = req.nextUrl.searchParams.get("from") ?? undefined;
  const to = req.nextUrl.searchParams.get("to") ?? undefined;
  const data = await listHostBookings({ status, from, to });
  return jsonOk({ data });
}
