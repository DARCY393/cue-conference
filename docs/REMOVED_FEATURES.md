# Removed features (off by default, restorable)

Three pricing/billing behaviors were removed from the default product when the
Arts District rooms (M1–M4) launched. Each is gated behind a flag in
[`lib/features.ts`](../lib/features.ts) and the underlying engine code is kept
intact so turning them back on is a config change, not a rewrite.

## 1. Long-booking discount (20% off at 8+ hours)

- **Flag:** `FEATURES.longBookingDiscount` — env `PRICING_ENABLE_LONG_BOOKING_DISCOUNT=true`
- **What changed:** `long_booking_discount_bps` was set to `0` for every room
  (migration `010_arts_district_rooms.sql`, `lib/seed.ts`'s `ROOM_PRICING`).
  `calculateQuote()` in `lib/quote.ts` only applies the discount when the flag
  is on **and** `pricing.longBookingDiscountBps > 0` — both gates must pass.
- **To restore:**
  1. Set `PRICING_ENABLE_LONG_BOOKING_DISCOUNT=true` in the environment.
  2. Set `long_booking_discount_bps` back to the desired value (e.g. `2000` for
     20%) on each room — `UPDATE spaces SET long_booking_discount_bps = 2000
     WHERE id IN (...)`, or the equivalent seed change for demo mode.

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
