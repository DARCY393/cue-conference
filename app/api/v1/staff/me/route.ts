import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { requireStaff } from "@/lib/staff-auth";

export async function GET(req: NextRequest) {
  const auth = await requireStaff(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  return jsonOk({ staff: auth.staff });
}
