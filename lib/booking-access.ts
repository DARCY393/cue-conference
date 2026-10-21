import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Unguessable, stateless access token for the guest's "Request received" page.
 *
 * The booking id alone is not treated as a secret (it appears in emails, Stripe metadata and
 * host tools), so the confirmation page additionally requires an HMAC of the booking id keyed by
 * SESSION_SECRET. Only the guest's browser receives it, in the authorize response.
 */
function accessSecret(): string {
  const configured = (process.env.SESSION_SECRET || "").trim();
  if (configured) return `booking-access:${configured}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production");
  }
  const g = globalThis as unknown as { __cueDevBookingAccessSecret?: string };
  if (!g.__cueDevBookingAccessSecret) g.__cueDevBookingAccessSecret = randomBytes(32).toString("hex");
  return g.__cueDevBookingAccessSecret;
}

export function bookingAccessToken(bookingId: string): string {
  return createHmac("sha256", accessSecret()).update(`requested:${bookingId}`).digest("base64url");
}

export function verifyBookingAccessToken(bookingId: string, token: string | null | undefined): boolean {
  if (!bookingId || !token || typeof token !== "string") return false;
  const expected = Buffer.from(bookingAccessToken(bookingId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function requestedPagePath(bookingId: string): string {
  return `/bookings/${encodeURIComponent(bookingId)}/requested?t=${bookingAccessToken(bookingId)}`;
}
