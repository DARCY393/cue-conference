import type { NextRequest } from "next/server";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

/** Per-IP request timestamps, in-memory — fine for a single-instance deploy. */
const hits = new Map<string, number[]>();

export function getClientIp(req: NextRequest): string {
  // nginx sets X-Real-IP to $remote_addr (not client-spoofable); prefer it.
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  // Otherwise use the right-most X-Forwarded-For hop (the one our proxy appended).
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").pop()!.trim();
  return "unknown";
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

/** Test-only: clears rate-limit state between test cases. */
export function _resetContactRateLimiter(): void {
  hits.clear();
}

