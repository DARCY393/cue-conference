import { NextRequest } from "next/server";
import { jsonOk } from "@/lib/http";
import { STAFF_SESSION_COOKIE, logoutStaffSession } from "@/lib/staff-auth";

export async function POST(req: NextRequest) {
  await logoutStaffSession(req.cookies.get(STAFF_SESSION_COOKIE)?.value);
  const res = jsonOk({ ok: true });
  res.cookies.set(STAFF_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
