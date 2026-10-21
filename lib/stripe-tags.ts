/**
 * Business tagging for every Stripe object this app creates, so D'Arcy can filter
 * Cue Arts District conference-room charges in the Stripe dashboard (metadata["business"] = "cue_arts_district_conference_room").
 */

export const STRIPE_BUSINESS = "cue_arts_district_conference_room";
export const STRIPE_BUSINESS_LABEL = "Cue Arts District Conference Room";

/**
 * Card statement descriptor suffix. Stripe shows "<account prefix>* <suffix>" and the
 * combined string must be <= 22 chars. The account's card prefix is "CUE", so
 * "CUE* CUE ARTS DIST" is 18. Full statement_descriptor is not set: Stripe rejects it on card PIs.
 */
export const STATEMENT_DESCRIPTOR_SUFFIX = "CUE ARTS DIST";
export const STATEMENT_DESCRIPTOR_MAX = 22;
/** The Stripe account's card statement descriptor prefix (Dashboard > Settings > Public details). */
export const ACCOUNT_CARD_PREFIX = "CUE";

/** Stripe-safe descriptor: Latin letters/digits/spaces and a few symbols, no < > \ ' " *, >= 1 letter. */
export function isValidDescriptorSuffix(s: string, prefixLen = ACCOUNT_CARD_PREFIX.length): boolean {
  if (!s || s.length > STATEMENT_DESCRIPTOR_MAX - prefixLen - 2) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  return /^[A-Za-z0-9 .,\-&#/]+$/.test(s);
}

export type BusinessTagInput = {
  bookingId: string;
  roomSlug?: string;
  roomName?: string;
  location?: string;
};

/** Stripe metadata values must be strings (<= 500 chars); empty keys are dropped. */
export function businessMetadata(
  input: BusinessTagInput,
  extra: Record<string, string | undefined> = {}
): Record<string, string> {
  const base: Record<string, string | undefined> = {
    business: STRIPE_BUSINESS,
    business_label: STRIPE_BUSINESS_LABEL,
    booking_id: input.bookingId,
    room_slug: input.roomSlug,
    location: input.location,
    ...extra,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && v !== null && v !== "") out[k] = String(v).slice(0, 500);
  }
  return out;
}

/** "Cue Arts District Conference Room – <room name> – booking <id>" (with an optional trailing note, e.g. overtime). */
export function paymentDescription(input: BusinessTagInput, note?: string): string {
  const room = input.roomName || input.roomSlug || "room";
  const base = `${STRIPE_BUSINESS_LABEL} – ${room} – booking ${input.bookingId}`;
  return note ? `${base} – ${note}` : base;
}

/** The common fields to spread into every paymentIntents.create call. */
export function paymentIntentTags(input: BusinessTagInput, opts: { note?: string; extra?: Record<string, string | undefined> } = {}) {
  return {
    metadata: businessMetadata(input, opts.extra),
    description: paymentDescription(input, opts.note),
    statement_descriptor_suffix: STATEMENT_DESCRIPTOR_SUFFIX,
  };
}
