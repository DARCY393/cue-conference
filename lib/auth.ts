import { NextRequest } from "next/server";

export function guestEmailFromRequest(req: NextRequest): string | null {
  return (
    req.headers.get("x-guest-email") ||
    req.headers.get("x-guest-session") ||
    null
  );
}
