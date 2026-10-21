/**
 * Guest-facing wording for the card hold, shared by the booking form, the "Request received"
 * page and the request-received email so they never drift apart.
 *
 * Accurate to the real flow: a manual-capture authorization is placed when the guest submits;
 * staff accepting captures it; declining (or the 24-hour auto-decline) cancels it.
 */
import { formatMoney } from "./format";

export const HOLD_HEADING = "Your card won't be charged yet";

export const FREE_CANCELLATION_TEXT = "Free cancellation up to 48 hours before your booking.";

export function holdBodyText(totalCents: number | null | undefined): string {
  const amount = typeof totalCents === "number" ? formatMoney(totalCents) : "the quoted amount";
  return (
    `We'll place a temporary hold of ${amount} on your card while we review your request. ` +
    "You're only charged if we confirm your booking. If we decline it, or don't respond within " +
    "24 hours, the hold is released automatically. Depending on your bank, a released hold can " +
    "take a few days to disappear from your statement."
  );
}

/** The card-form submit button. En dash, per D'Arcy's copy. */
export function holdButtonLabel(totalCents: number | null | undefined): string {
  return typeof totalCents === "number"
    ? `Request booking – hold ${formatMoney(totalCents)}`
    : "Request booking – place hold";
}

export const WHAT_HAPPENS_NEXT: { title: string; body: string }[] = [
  {
    title: "We review your request",
    body: "Usually within a few hours; at most 24 hours.",
  },
  {
    title: "If approved, your card is charged",
    body: "You'll get a confirmation email with arrival instructions, Wi-Fi and parking details.",
  },
  {
    title: "If we can't host you, nothing is charged",
    body: "If we decline, or don't respond within 24 hours, the hold is released and nothing is charged.",
  },
  {
    title: "Free cancellation",
    body: "Cancel for free up to 48 hours before your booking.",
  },
];

export const CONTACT_NAME = "D'Arcy Young";
export const CONTACT_PHONE_DISPLAY = "214-883-4174";
export const CONTACT_PHONE_TEL = "+12148834174";
export const CONTACT_SUITE = "suite 212";
