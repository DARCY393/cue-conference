/** Kill-switches for pricing/billing behavior removed from the default product. See docs/REMOVED_FEATURES.md. */
export const FEATURES = {
  /** On by default (restored); set PRICING_ENABLE_LONG_BOOKING_DISCOUNT=false to kill-switch it off. */
  get longBookingDiscount(): boolean {
    return process.env.PRICING_ENABLE_LONG_BOOKING_DISCOUNT !== "false";
  },
  get overtime(): boolean {
    return process.env.PRICING_ENABLE_OVERTIME === "true";
  },
  get parkingAddon(): boolean {
    return process.env.PRICING_ENABLE_PARKING_ADDON === "true";
  },
};
