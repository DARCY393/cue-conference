export type BookingStatus =
  | "draft"
  | "requested"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled"
  | "in_progress"
  | "completed";

export type AddonUnit = "per_booking" | "per_day" | "per_item";

export interface FlexibleRules {
  full_refund_days_before: number;
  partial_refund_hours_before: number;
  partial_refund_bps: number;
  partial_excludes_fees: boolean;
  grace_hours_after_confirm: number;
  grace_requires_hours_before_start: number;
}

export interface SpacePricing {
  currency: string;
  baseHourlyCents: number;
  minHours: number;
  longBookingThresholdHours: number;
  longBookingDiscountBps: number;
  overtimeMultiplier: number;
  cleaningIncluded: boolean;
}

export interface BookableHours {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface AddonPublic {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  unit: AddonUnit;
  leadTimeHours: number;
  requiresGuestFields?: string[];
}

export interface LocationPublic {
  id: string;
  slug: string;
  name: string;
  city: string;
  neighborhood?: string;
  addressPublic?: string;
  timezone?: string;
}

export interface SpacePublic {
  id: string;
  slug: string;
  title: string;
  shortTitle?: string;
  subtitle?: string;
  description?: string;
  city: string;
  neighborhood?: string;
  timezone: string;
  capacity: number;
  status: "draft" | "live" | "paused";
  pricing: SpacePricing;
  bookableHours: BookableHours[];
  photos: { url: string; alt?: string; sortOrder: number }[];
  amenities: { key: string; label: string }[];
  addons: AddonPublic[];
  hostRulesMd?: string;
  healthSafetyMd?: string;
  cancellationPolicy?: { name: string; rules: FlexibleRules };
  approxLocation?: { lat: number; lng: number };
  host?: { name: string };
  addressPrivate?: string;
  hostId?: string;
  cancellationPolicyId?: string;
  location?: LocationPublic;
  locationId?: string;
  /** Private — calendar sync internals. Never serialize to guest/public API responses. */
  googleCalendarId?: string;
  /** Private — extra calendars checked for busy only (not written to). */
  googleBusyCalendarIds?: string[];
}

export interface QuoteAddonInput {
  addonId: string;
  quantity?: number;
  meta?: Record<string, unknown>;
}

export interface QuoteLineItem {
  code: string;
  label: string;
  amountCents: number;
}

export interface Quote {
  currency: string;
  hours: number;
  baseCents: number;
  discountCents: number;
  addonsCents: number;
  feesCents: number;
  taxCents: number;
  totalCents: number;
  available: boolean;
  lineItems: QuoteLineItem[];
  expiresAt?: string;
}

export interface Booking {
  id: string;
  spaceId: string;
  guestId?: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  guestNotes?: string;
  activityDescription?: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  addonsCents: number;
  feesCents: number;
  taxCents: number;
  totalCents: number;
  addons?: {
    addonId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    meta?: Record<string, unknown>;
  }[];
  requestedAt?: string;
  hostActionDeadlineAt?: string;
  decidedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
  stripePaymentIntentId?: string;
  googleEventId?: string;
  accessDetails?: string;
  createdAt: string;
  guestEmail?: string;
  guestName?: string;
  quoteJson?: Quote;
  spaceTitle?: string;
  locationName?: string;
  spaceSlug?: string;
}

export interface Blockout {
  id: string;
  spaceId: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
}

export interface BusyInterval {
  startsAt: string;
  endsAt: string;
  kind: "booking" | "blockout" | "google";
}
