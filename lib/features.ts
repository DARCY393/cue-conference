/** Kill-switches for pricing/billing behavior removed from the default product. See docs/REMOVED_FEATURES.md. */
export const FEATURES = {
  get longBookingDiscount(): boolean {
    return process.env.PRICING_ENABLE_LONG_BOOKING_DISCOUNT === "true";
  },
  get overtime(): boolean {
    return process.env.PRICING_ENABLE_OVERTIME === "true";
  },
  get parkingAddon(): boolean {
    return process.env.PRICING_ENABLE_PARKING_ADDON === "true";
  },
};
