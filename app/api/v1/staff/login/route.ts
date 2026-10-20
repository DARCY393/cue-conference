import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import {
  STAFF_SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  buildSessionCookieValue,
  loginStaff,
} from "@/lib/staff-auth";

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_request", "Expected a JSON body with email and password.");
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return jsonError(400, "invalid_request", "Email and password are required.");
  }

  const result = await loginStaff(email, password);
  if (!result.ok) {
    return jsonError(result.status, result.error, result.message);
  }

  const res = jsonOk({ staff: result.staff });
  res.cookies.set(STAFF_SESSION_COOKIE, buildSessionCookieValue(result.token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
