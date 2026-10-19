# Cue booking — Postgres migrations

Apply in order:

```bash
psql "$DATABASE_URL" -f migrations/001_extensions.sql
psql "$DATABASE_URL" -f migrations/002_enums.sql
psql "$DATABASE_URL" -f migrations/003_users_and_spaces.sql
psql "$DATABASE_URL" -f migrations/004_listing_catalog.sql
psql "$DATABASE_URL" -f migrations/005_bookings.sql
psql "$DATABASE_URL" -f migrations/006_payments_and_messages.sql
psql "$DATABASE_URL" -f migrations/007_helpers.sql
psql "$DATABASE_URL" -f migrations/008_seed_cue.sql   # optional
psql "$DATABASE_URL" -f migrations/009_locations.sql  # locations + room 2
psql "$DATABASE_URL" -f migrations/010_arts_district_rooms.sql  # Arts District rename + M1-M4
psql "$DATABASE_URL" -f migrations/011_restore_discount_and_room_photos.sql  # 20% long-booking discount + room photos
```

Or:

```bash
for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

## Inventory constraints

- `bookings_no_overlap` — GiST exclusion on `(space_id, tstzrange)` for statuses `requested`, `accepted`, `in_progress`
- `blockouts_no_overlap` — same for host blockouts
- App should still call `space_is_available(...)` and `space_within_bookable_hours(...)` before creating a PaymentIntent

## Notes

- Money is integer cents
- Half-open ranges `[starts_at, ends_at)` so back-to-back bookings are allowed
- Host accept must re-check availability inside a transaction before Stripe capture

## Applying 009 on an existing DB

`009_locations.sql` is idempotent (`IF NOT EXISTS` / `ON CONFLICT`). Preferred:

```bash
npm run db:migrate          # skips 001–008 after bootstrap; applies 009
# or
npm run db:migrate:009
# or
psql "$DATABASE_URL" -f migrations/009_locations.sql
```

## Applying 010 on an existing DB

`010_arts_district_rooms.sql` is idempotent (`IF NOT EXISTS` / `ON CONFLICT` / guarded `ALTER`).
It renames the Arts District location, renames the two existing rooms to M1/M2, adds M3/M4,
adds `spaces.google_calendar_id` / `spaces.google_busy_calendar_ids` / `bookings.google_event_id`,
and deactivates the parking add-on. Preferred:

```bash
npm run db:migrate          # skips already-applied files; applies 010
# or
npm run db:migrate:010
# or
psql "$DATABASE_URL" -f migrations/010_arts_district_rooms.sql
```
