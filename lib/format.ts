import type { SpacePublic } from "./types";

/** Full currency formatting, always 2 decimal places (quotes/totals keep cents). */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Hourly-rate display: whole dollars render without cents (e.g. "$70"), otherwise falls back to formatMoney. */
export function formatRate(cents: number): string {
  if (cents % 100 === 0) return `$${cents / 100}`;
  return formatMoney(cents);
}

/** Short room label for UI chips/buttons, e.g. "M2". Falls back to the slug's last segment. */
export function roomCode(space: Pick<SpacePublic, "shortTitle" | "slug">): string {
  return space.shortTitle || space.slug.split("-").pop() || space.slug;
}
