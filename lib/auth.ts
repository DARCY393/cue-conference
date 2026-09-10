import { NextRequest } from "next/server";
import { HOST_EMAIL_DEFAULT } from "./seed";

export function hostEmail(): string {
  return process.env.HOST_EMAIL || HOST_EMAIL_DEFAULT;
}

/**
 * Simple host gate: Authorization: Bearer <HOST_EMAIL> or x-host-email header
 * matching HOST_EMAIL env.
 */
export function requireHost(req: NextRequest): { ok: true } | { ok: false; status: number; error: string; message: string } {
  const expected = hostEmail().toLowerCase();
  const auth = req.headers.get("authorization");
  const headerEmail = req.headers.get("x-host-email");
  let email: string | null = null;
  if (auth?.toLowerCase().startsWith("bearer ")) {
    email = auth.slice(7).trim();
  } else if (headerEmail) {
    email = headerEmail.trim();
  }
  if (!email || email.toLowerCase() !== expected) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "Host authentication required. Send Authorization: Bearer <HOST_EMAIL>.",
    };
  }
  return { ok: true };
}

export function guestEmailFromRequest(req: NextRequest): string | null {
  return (
    req.headers.get("x-guest-email") ||
    req.headers.get("x-guest-session") ||
    null
  );
}
