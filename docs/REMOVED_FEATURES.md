# Removed features (off by default, restorable)

Four pricing/billing behaviors were removed (or, in one case, never shipped)
from the default product when the Arts District rooms (M1–M4) launched. Three
remain gated behind a flag in [`lib/features.ts`](../lib/features.ts) and the
underlying engine code is kept intact so turning them back on is a config
change, not a rewrite. The long-booking discount (below) has since been
restored to the default product.

## 1. Long-booking discount (20% off at 8+ total billable hours) — RESTORED

- **Status:** back on by default for all rooms (M1–M4) as of migration
  `011_restore_discount_and_room_photos.sql` / `lib/seed.ts`'s `ROOM_PRICING`
  (`long_booking_discount_bps = 2000`, `longBookingThresholdHours = 8`).
- **Flag:** `FEATURES.longBookingDiscount` in `lib/features.ts` defaults to
  `true`; set env `PRICING_ENABLE_LONG_BOOKING_DISCOUNT=false` to kill-switch
  it off without a deploy. `calculateQuote()` in `lib/quote.ts` applies the
  discount whenever the flag is on **and** `pricing.longBookingDiscountBps > 0`
  **and** total billable hours for the reservation `>= longBookingThresholdHours`.
- **Multi-day reservations:** the threshold and discount apply once to the
  total billable hours across the whole reservation (every bookable weekday
  from the start date to the optional end date), not per day — see
  `expandDayWindows()` in `lib/availability.ts` and the "Multi-day bookings"
  note there for how total hours are computed and how the booking's stored
  `startsAt`/`endsAt` span is derived.

## 2. Overtime billing (1.5× per 30 minutes)

- **Flag:** `FEATURES.overtime` — env `PRICING_ENABLE_OVERTIME=true`
- **What changed:** `POST /api/v1/host/bookings/{bookingId}/overtime`
  (`app/api/v1/host/bookings/[bookingId]/overtime/route.ts`) returns
  `404 {"error":"feature_disabled"}` when the flag is off. The "Charge OT"
  control was removed from the host UI (`app/host/page.tsx`), and the
  "Overtime billed in 30-minute increments at 1.5× hourly rate" line was
  removed from the house rules text (`lib/seed.ts`, migration `010`).
  `calculateOvertimeCents()` in `lib/quote.ts` is untouched — only the API
  route and copy were gated/removed.
- **To restore:**
  1. Set `PRICING_ENABLE_OVERTIME=true` in the environment.
  2. Re-add a host UI control that calls the overtime endpoint (see git
     history for `app/host/page.tsx` before this change for a starting point).
  3. Optionally restore the house-rules copy line.

## 3. Parking add-on ($25/day)

- **Flag:** `FEATURES.parkingAddon` — env `PRICING_ENABLE_PARKING_ADDON=true`
- **What changed:** the `Parking` addon rows (`d0000000-...-0001` /
  `...-0002`) were deactivated (`addons.active = false`) in migration `010`.
  In demo mode, `lib/seed.ts` only includes the addon in a room's catalog when
  `FEATURES.parkingAddon` is on; the definition is kept as
  `legacyParkingAddon(id)` / `LEGACY_PARKING_ADDON` for reuse. The guest room
  page (`app/spaces/[slug]/page.tsx`) only renders the parking checkbox when
  `space.addons[0]` exists, so an empty catalog hides the UI automatically.
- **To restore:**
  1. Set `PRICING_ENABLE_PARKING_ADDON=true` in the environment (demo mode
     picks this up automatically via `lib/seed.ts`).
  2. For a real database, also flip the rows back on:
     `UPDATE addons SET active = true WHERE id IN
     ('d0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000002')` (and add rows for M3/M4 if
     parking should apply there too — the flag alone does not resurrect
     deactivated DB rows).

## 4. 3-hour minimum booking (never shipped)

- **Flag:** none — there is no feature flag for this because it never made
  it into the default product in the first place.
- **What changed:** an earlier draft of the Arts District pricing called for
  a flat 3-hour minimum booking length. The shipped product uses a **per-room**
  `minHours` instead (`lib/types.ts`'s `SpacePricing.minHours`,
  `DEFAULT_MIN_HOURS` in `lib/seed.ts`), defaulting to **1 hour**, enforced in
  `calculateQuote()` (`lib/quote.ts`) and on the booking-create API. Every
  current room (M1–M4) is seeded with `minHours: 1`.
- **To restore:** set `minHours` to `3` (or whatever value is wanted) on the
  relevant room(s) — in `lib/seed.ts` for demo mode, or
  `UPDATE spaces SET min_hours = 3 WHERE id IN (...)` for a real database.
  This can be set per room; there's no single global switch.
