-- Arts District rename + 4 named rooms (M1-M4) + per-room Google Calendar columns
-- Safe to apply on existing DBs (IF NOT EXISTS / ON CONFLICT / guarded ALTER)

-- 1. Rename the location (keep id; add an alias so old slug still resolves)
UPDATE locations SET
  slug = 'arts-district',
  name = 'Cue Arts District',
  city = 'Dallas',
  neighborhood = 'Arts District',
  timezone = 'America/Chicago',
  address_public = '750 N. St. Paul Street, Dallas, TX 75201',
  updated_at = now()
WHERE id = 'e0000000-0000-4000-8000-000000000001';

CREATE TABLE IF NOT EXISTS location_slug_aliases (
  alias        text PRIMARY KEY,
  location_id  uuid NOT NULL REFERENCES locations (id) ON DELETE CASCADE
);

INSERT INTO location_slug_aliases (alias, location_id)
VALUES ('downtown-arts-district', 'e0000000-0000-4000-8000-000000000001')
ON CONFLICT (alias) DO UPDATE SET location_id = EXCLUDED.location_id;

-- 2. Per-room calendar columns (used by a later chunk)
ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS google_calendar_id text,
  ADD COLUMN IF NOT EXISTS google_busy_calendar_ids text[] NOT NULL DEFAULT '{}';

-- 2b. Short room label (e.g. "M1") used in quote line items; title stays "M1 Meeting Room".
ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS short_title text;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS google_event_id text;

-- 3. M1 — reuse the former "cue-dallas" row
UPDATE spaces SET
  slug = 'arts-district-m1',
  title = 'M1 Meeting Room',
  short_title = 'M1',
  subtitle = '10 seats · Cue Arts District',
  description = 'Meeting room for presentations, team meetings, and workshops.',
  capacity = 10,
  neighborhood = 'Arts District',
  min_hours = 1,
  base_hourly_cents = 7000,
  long_booking_discount_bps = 0,
  overtime_multiplier = 1.50,
  location_id = 'e0000000-0000-4000-8000-000000000001',
  google_calendar_id = 'c_e88039667398de2f9dd4f5b5c52147b034323e48620c7cb4c278eefcdc0601a6@group.calendar.google.com',
  google_busy_calendar_ids = '{}',
  updated_at = now()
WHERE id = 'c0000000-0000-4000-8000-000000000001';

-- 4. M2 — reuse the former "cue-downtown-boardroom" row
UPDATE spaces SET
  slug = 'arts-district-m2',
  title = 'M2 Meeting Room',
  short_title = 'M2',
  subtitle = '20 seats · Cue Arts District',
  description = 'Meeting room for presentations, team meetings, and workshops.',
  capacity = 20,
  neighborhood = 'Arts District',
  min_hours = 1,
  base_hourly_cents = 12500,
  long_booking_discount_bps = 0,
  overtime_multiplier = 1.50,
  location_id = 'e0000000-0000-4000-8000-000000000001',
  google_calendar_id = 'c_8b3363b1a13418a42df25d270780f453fa4f4e2de9be4b5d85bc3119ea23ff3a@group.calendar.google.com',
  google_busy_calendar_ids = ARRAY['c_4a620221db3b792706f2006543986fa6ba4de1b596798b2977daef22623147c9@group.calendar.google.com'],
  updated_at = now()
WHERE id = 'c0000000-0000-4000-8000-000000000002';

-- 5. M3 — new room
INSERT INTO spaces (
  id, host_id, slug, title, short_title, subtitle, description,
  city, neighborhood, timezone, capacity, status,
  min_hours, base_hourly_cents, overtime_multiplier,
  long_booking_threshold_hours, long_booking_discount_bps,
  cleaning_included, address_private, location_id,
  google_calendar_id, google_busy_calendar_ids
)
SELECT
  'c0000000-0000-4000-8000-000000000003',
  s.host_id,
  'arts-district-m3',
  'M3 Meeting Room',
  'M3',
  '5 seats · Cue Arts District',
  'Meeting room for presentations, team meetings, and workshops.',
  s.city,
  'Arts District',
  s.timezone,
  5,
  'live',
  1,
  3500,
  1.50,
  s.long_booking_threshold_hours,
  0,
  s.cleaning_included,
  s.address_private,
  'e0000000-0000-4000-8000-000000000001',
  'c_fa24824eeb56172234a4e332185b1590926da705c57c76d6d99d3a164f696ba6@group.calendar.google.com',
  '{}'
FROM spaces s
WHERE s.id = 'c0000000-0000-4000-8000-000000000001'
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  short_title = EXCLUDED.short_title,
  subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description,
  capacity = EXCLUDED.capacity,
  neighborhood = EXCLUDED.neighborhood,
  min_hours = EXCLUDED.min_hours,
  base_hourly_cents = EXCLUDED.base_hourly_cents,
  overtime_multiplier = EXCLUDED.overtime_multiplier,
  long_booking_discount_bps = EXCLUDED.long_booking_discount_bps,
  location_id = EXCLUDED.location_id,
  google_calendar_id = EXCLUDED.google_calendar_id,
  google_busy_calendar_ids = EXCLUDED.google_busy_calendar_ids,
  updated_at = now();

-- 6. M4 — new room
INSERT INTO spaces (
  id, host_id, slug, title, short_title, subtitle, description,
  city, neighborhood, timezone, capacity, status,
  min_hours, base_hourly_cents, overtime_multiplier,
  long_booking_threshold_hours, long_booking_discount_bps,
  cleaning_included, address_private, location_id,
  google_calendar_id, google_busy_calendar_ids
)
SELECT
  'c0000000-0000-4000-8000-000000000004',
  s.host_id,
  'arts-district-m4',
  'M4 Meeting Room',
  'M4',
  '10 seats · Cue Arts District',
  'Meeting room for presentations, team meetings, and workshops.',
  s.city,
  'Arts District',
  s.timezone,
  10,
  'live',
  1,
  7000,
  1.50,
  s.long_booking_threshold_hours,
  0,
  s.cleaning_included,
  s.address_private,
  'e0000000-0000-4000-8000-000000000001',
  'c_44bb9580defceabfbb00be84aee1b13223c607efffc9051673f813a5e03a6152@group.calendar.google.com',
  '{}'
FROM spaces s
WHERE s.id = 'c0000000-0000-4000-8000-000000000001'
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  short_title = EXCLUDED.short_title,
  subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description,
  capacity = EXCLUDED.capacity,
  neighborhood = EXCLUDED.neighborhood,
  min_hours = EXCLUDED.min_hours,
  base_hourly_cents = EXCLUDED.base_hourly_cents,
  overtime_multiplier = EXCLUDED.overtime_multiplier,
  long_booking_discount_bps = EXCLUDED.long_booking_discount_bps,
  location_id = EXCLUDED.location_id,
  google_calendar_id = EXCLUDED.google_calendar_id,
  google_busy_calendar_ids = EXCLUDED.google_busy_calendar_ids,
  updated_at = now();

-- 7. Cancellation policy for M3, M4 (same as M1)
INSERT INTO space_cancellation_policies (space_id, cancellation_policy_id)
SELECT 'c0000000-0000-4000-8000-000000000003', scp.cancellation_policy_id
FROM space_cancellation_policies scp
WHERE scp.space_id = 'c0000000-0000-4000-8000-000000000001'
ON CONFLICT (space_id) DO NOTHING;

INSERT INTO space_cancellation_policies (space_id, cancellation_policy_id)
SELECT 'c0000000-0000-4000-8000-000000000004', scp.cancellation_policy_id
FROM space_cancellation_policies scp
WHERE scp.space_id = 'c0000000-0000-4000-8000-000000000001'
ON CONFLICT (space_id) DO NOTHING;

-- 8. Bookable hours Mon-Fri 7:00-18:00 for M3, M4
INSERT INTO bookable_hours (space_id, weekday, start_minute, end_minute)
SELECT 'c0000000-0000-4000-8000-000000000003', d, 7 * 60, 18 * 60
FROM generate_series(1, 5) AS d
ON CONFLICT ON CONSTRAINT bookable_hours_unique_window DO NOTHING;

INSERT INTO bookable_hours (space_id, weekday, start_minute, end_minute)
SELECT 'c0000000-0000-4000-8000-000000000004', d, 7 * 60, 18 * 60
FROM generate_series(1, 5) AS d
ON CONFLICT ON CONSTRAINT bookable_hours_unique_window DO NOTHING;

-- 9. Amenities for M3, M4 (same set as M1)
INSERT INTO space_amenities (space_id, amenity_id)
SELECT 'c0000000-0000-4000-8000-000000000003', a.id
FROM amenities a
WHERE a.key IN (
  'wifi','tables','chairs','screen','whiteboard','monitor',
  'conference_phone','apple_tv','coffee','projector','printer',
  'restrooms','kitchen','wheelchair_accessible'
)
ON CONFLICT DO NOTHING;

INSERT INTO space_amenities (space_id, amenity_id)
SELECT 'c0000000-0000-4000-8000-000000000004', a.id
FROM amenities a
WHERE a.key IN (
  'wifi','tables','chairs','screen','whiteboard','monitor',
  'conference_phone','apple_tv','coffee','projector','printer',
  'restrooms','kitchen','wheelchair_accessible'
)
ON CONFLICT DO NOTHING;

-- 10. House rules — drop the overtime line everywhere; add rows for M3, M4
UPDATE host_rules SET
  body_md = $md$
- Leave the space as found; tidy up and remove equipment/rentals by end time
- No nails, screws, staples, tape, or gum-backed materials
- Furniture moves require advance notice
- No smoking, glitter/confetti, open flames, frying, or high-smoke cooking
- Damages billed to the card on file
  $md$,
  updated_at = now()
WHERE space_id IN (
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002'
);

INSERT INTO host_rules (space_id, body_md)
VALUES (
  'c0000000-0000-4000-8000-000000000003',
  $md$
- Leave the space as found; tidy up and remove equipment/rentals by end time
- No nails, screws, staples, tape, or gum-backed materials
- Furniture moves require advance notice
- No smoking, glitter/confetti, open flames, frying, or high-smoke cooking
- Damages billed to the card on file
  $md$
)
ON CONFLICT (space_id) DO NOTHING;

INSERT INTO host_rules (space_id, body_md)
VALUES (
  'c0000000-0000-4000-8000-000000000004',
  $md$
- Leave the space as found; tidy up and remove equipment/rentals by end time
- No nails, screws, staples, tape, or gum-backed materials
- Furniture moves require advance notice
- No smoking, glitter/confetti, open flames, frying, or high-smoke cooking
- Damages billed to the card on file
  $md$
)
ON CONFLICT (space_id) DO NOTHING;

-- 11. Photos — copy M1's photo to any of M2/M3/M4 that don't already have one
INSERT INTO space_photos (space_id, url, alt, sort_order)
SELECT targets.sid, p.url, p.alt, p.sort_order
FROM space_photos p
CROSS JOIN (
  VALUES
    ('c0000000-0000-4000-8000-000000000002'::uuid),
    ('c0000000-0000-4000-8000-000000000003'::uuid),
    ('c0000000-0000-4000-8000-000000000004'::uuid)
) AS targets (sid)
WHERE p.space_id = 'c0000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM space_photos existing WHERE existing.space_id = targets.sid
  );

-- 12. Parking add-on removed from the default product; deactivate existing rows (restorable)
UPDATE addons SET active = false, updated_at = now()
WHERE id IN (
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002'
);
