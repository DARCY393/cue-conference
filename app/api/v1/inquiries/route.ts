import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";
import { submitInquiry } from "@/lib/inquiries";
import { issueFormToken, turnstileEnabled } from "@/lib/inquiry-spam";

export const dynamic = "force-dynamic";

/** Called when the form opens: a signed timestamp (for the time-to-submit check) + Turnstile site key. */
export async function GET() {
  return jsonOk({
    formToken: issueFormToken(),
    turnstileSiteKey: turnstileEnabled() ? process.env.TURNSTILE_SITE_KEY : null,
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }
  if (!body || typeof body !== "object") return jsonError(400, "bad_request", "Invalid JSON body");
  const result = await submitInquiry(body, getClientIp(req));
  if (result.kind === "invalid") return jsonError(400, "bad_request", result.message);
  if (result.kind === "rate_limited") {
    return jsonError(
      429,
      "rate_limited",
      "You've sent a few questions already — we'll reply to those by email soon. Please try again later."
    );
  }
  return jsonOk({ ok: true });
}
