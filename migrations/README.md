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
