import type { NextRequest } from "next/server";

export function getClientIp(req: NextRequest): string {
  // nginx sets X-Real-IP to $remote_addr (not client-spoofable); prefer it.
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  // Otherwise use the right-most X-Forwarded-For hop (the one our proxy appended).
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").pop()!.trim();
  return "unknown";
}
