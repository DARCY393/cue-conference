import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/staff-auth";
import { jsonError, jsonOk } from "@/lib/http";
import { listInquiries } from "@/lib/inquiries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireStaff(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const includeSpam = req.nextUrl.searchParams.get("spam") === "1";
  const rows = await listInquiries(200);
  const data = rows
    .filter((r) => includeSpam || r.spamVerdict === "ok")
    .map((r) => ({ ...r, ipHash: undefined }));
  return jsonOk({ data });
}
