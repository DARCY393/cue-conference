import type { AddonPublic, Quote, QuoteAddonInput, QuoteLineItem, SpacePricing } from "./types";
import { FEATURES } from "./features";

export interface QuoteFeatureFlags {
  longBookingDiscount?: boolean;
}

export interface QuoteInput {
  startsAt: Date;
  endsAt: Date;
  pricing: SpacePricing;
  addonsCatalog: AddonPublic[];
  addonSelections?: QuoteAddonInput[];
  available?: boolean;
  feesCents?: number;
  taxCents?: number;
  /** Override feature flags (tests / legacy fixtures); defaults to FEATURES. */
  features?: QuoteFeatureFlags;
  /** Short room label for the space line item, e.g. "M2". Defaults to "Meeting room". */
  roomLabel?: string;
  /**
   * Precomputed total billable hours for a multi-day reservation (sum of
   * each bookable day's window). When set, overrides the startsAt/endsAt
   * difference — see `expandDayWindows()` in `lib/availability.ts`.
   */
  totalHours?: number;
}

function hoursBetween(startsAt: Date, endsAt: Date): number {
  const ms = endsAt.getTime() - startsAt.getTime();
  if (ms <= 0) return 0;
  return ms / (1000 * 60 * 60);
}

/** Calendar days spanned for per_day addons (min 1). */
export function calendarDaysSpanned(startsAt: Date, endsAt: Date): number {
  const start = Date.UTC(
    startsAt.getUTCFullYear(),
    startsAt.getUTCMonth(),
    startsAt.getUTCDate()
  );
  // endsAt is exclusive half-open; last occupied instant is endsAt - 1ms
  const last = new Date(endsAt.getTime() - 1);
  const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  return Math.max(1, Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1);
}

export function computeAddonCents(
  catalog: AddonPublic[],
  selections: QuoteAddonInput[] | undefined,
  startsAt: Date,
  endsAt: Date
): { addonsCents: number; lineItems: QuoteLineItem[]; resolved: { addon: AddonPublic; quantity: number; unitPriceCents: number; lineCents: number; meta?: Record<string, unknown> }[] } {
  const lineItems: QuoteLineItem[] = [];
  const resolved: {
    addon: AddonPublic;
    quantity: number;
    unitPriceCents: number;
    lineCents: number;
    meta?: Record<string, unknown>;
  }[] = [];
  let addonsCents = 0;
  const days = calendarDaysSpanned(startsAt, endsAt);

  for (const sel of selections ?? []) {
    const addon = catalog.find((a) => a.id === sel.addonId);
    if (!addon) {
      throw new Error(`Unknown addon: ${sel.addonId}`);
    }
    const quantity = sel.quantity ?? 1;
    if (quantity < 1) throw new Error("Addon quantity must be >= 1");

    let units = quantity;
    if (addon.unit === "per_day") units = quantity * days;

    const lineCents = addon.priceCents * units;
    addonsCents += lineCents;
    lineItems.push({
      code: `addon_${addon.name.toLowerCase().replace(/\s+/g, "_")}`,
      label: addon.unit === "per_day" ? `${addon.name} (${days} day${days === 1 ? "" : "s"})` : addon.name,
      amountCents: lineCents,
    });
    resolved.push({
      addon,
      quantity,
      unitPriceCents: addon.priceCents,
      lineCents,
      meta: sel.meta,
    });
  }

  return { addonsCents, lineItems, resolved };
}

export function calculateQuote(input: QuoteInput): Quote {
  const { startsAt, endsAt, pricing, addonsCatalog, addonSelections } = input;
  const hours = input.totalHours ?? hoursBetween(startsAt, endsAt);

  if (hours <= 0) {
    throw new Error("endsAt must be after startsAt");
  }
  if (hours < pricing.minHours) {
    const hourWord = pricing.minHours === 1 ? "hour" : "hours";
    throw new Error(`Minimum booking is ${pricing.minHours} ${hourWord}.`);
  }

  const baseCents = Math.round(hours * pricing.baseHourlyCents);
  const longBookingDiscountEnabled =
    input.features?.longBookingDiscount ?? FEATURES.longBookingDiscount;
  let discountCents = 0;
  if (
    longBookingDiscountEnabled &&
    hours >= pricing.longBookingThresholdHours &&
    pricing.longBookingDiscountBps > 0
  ) {
    discountCents = Math.floor((baseCents * pricing.longBookingDiscountBps) / 10000);
  }

  const { addonsCents, lineItems: addonLines } = computeAddonCents(
    addonsCatalog,
    addonSelections,
    startsAt,
    endsAt
  );

  const feesCents = input.feesCents ?? 0;
  const taxCents = input.taxCents ?? 0;
  const totalCents = baseCents - discountCents + addonsCents + feesCents + taxCents;

  const roomLabel = input.roomLabel ?? "Meeting room";
  const lineItems: QuoteLineItem[] = [
    {
      code: "space",
      label: `${roomLabel} · ${hours}h × $${(pricing.baseHourlyCents / 100).toFixed(2)}`,
      amountCents: baseCents,
    },
  ];
  if (discountCents > 0) {
    lineItems.push({
      code: "discount_long_booking",
      label: `Long booking discount (${pricing.longBookingDiscountBps / 100}%)`,
      amountCents: -discountCents,
    });
  }
  lineItems.push(...addonLines);
  if (feesCents > 0) {
    lineItems.push({ code: "fee", label: "Fees", amountCents: feesCents });
  }
  if (taxCents > 0) {
    lineItems.push({ code: "tax", label: "Tax", amountCents: taxCents });
  }

  return {
    currency: pricing.currency,
    hours,
    baseCents,
    discountCents,
    addonsCents,
    feesCents,
    taxCents,
    totalCents,
    available: input.available ?? true,
    lineItems,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

/** Overtime: 30-min steps at overtimeMultiplier × hourly. */
export function calculateOvertimeCents(
  extraMinutes: number,
  baseHourlyCents: number,
  overtimeMultiplier: number
): number {
  if (extraMinutes < 30 || extraMinutes % 30 !== 0) {
    throw new Error("extraMinutes must be a positive multiple of 30");
  }
  const hours = extraMinutes / 60;
  return Math.round(hours * baseHourlyCents * overtimeMultiplier);
}
