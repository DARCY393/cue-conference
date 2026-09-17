-- Multi-location architecture + second Downtown room
-- Safe to apply on existing DBs (IF NOT EXISTS / ON CONFLICT / guarded ALTER)

CREATE TABLE IF NOT EXISTS locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL,
  name            text NOT NULL,
  city            text NOT NULL DEFAULT 'Dallas',
  neighborhood    text,
  timezone        text NOT NULL DEFAULT 'America/Chicago',
  address_public  text,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_slug_unique UNIQUE (slug)
);

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations (id);

CREATE INDEX IF NOT EXISTS spaces_location_id_idx ON spaces (location_id);

-- Seed Arts District / Downtown location
INSERT INTO locations (
  id, slug, name, city, neighborhood, timezone, address_public, sort_order
) VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'downtown-arts-district',
  'Arts District / Downtown',
  'Dallas',
  'Arts District',
  'America/Chicago',
  '750 N. St. Paul Street, Dallas, TX 75201',
  0
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  city = EXCLUDED.city,
  neighborhood = EXCLUDED.neighborhood,
  timezone = EXCLUDED.timezone,
  address_public = EXCLUDED.address_public,
  updated_at = now();

-- Attach existing cue-dallas space; clarify title/subtitle/neighborhood
UPDATE spaces SET
  location_id = 'e0000000-0000-4000-8000-000000000001',
  neighborhood = 'Arts District',
  title = 'Conference Room',
  subtitle = '10 person · Arts District / Downtown',
  updated_at = now()
WHERE slug = 'cue-dallas';

-- Second room at same location (placeholder copy — confirm with client)
INSERT INTO spaces (
  id, host_id, slug, title, subtitle, description,
  city, neighborhood, timezone, capacity, status,
  min_hours, base_hourly_cents, overtime_multiplier,
  long_booking_threshold_hours, long_booking_discount_bps,
  cleaning_included, address_private, location_id
)
SELECT
  'c0000000-0000-4000-8000-000000000002',
  s.host_id,
  'cue-downtown-boardroom',
  'Boardroom',
  '8–12 person conference room · Arts District / Downtown',
  'Private boardroom for presentations, team meetings, workshops, and brainstorming. Capacity and rates are placeholders pending client confirmation.',
  s.city,
  'Arts District',
  s.timezone,
  10,
  'live',
  s.min_hours,
  s.base_hourly_cents,
  s.overtime_multiplier,
  s.long_booking_threshold_hours,
  s.long_booking_discount_bps,
  s.cleaning_included,
  s.address_private,
  'e0000000-0000-4000-8000-000000000001'
FROM spaces s
WHERE s.slug = 'cue-dallas'
ON CONFLICT (slug) DO NOTHING;

-- Ensure location_id even if INSERT was a no-op from a prior partial run
UPDATE spaces SET
  location_id = 'e0000000-0000-4000-8000-000000000001',
  neighborhood = COALESCE(neighborhood, 'Arts District'),
  updated_at = now()
WHERE slug = 'cue-downtown-boardroom'
  AND (location_id IS DISTINCT FROM 'e0000000-0000-4000-8000-000000000001'
       OR neighborhood IS DISTINCT FROM 'Arts District');

-- Cancellation policy for room 2
INSERT INTO space_cancellation_policies (space_id, cancellation_policy_id)
SELECT
  'c0000000-0000-4000-8000-000000000002',
  scp.cancellation_policy_id
FROM space_cancellation_policies scp
WHERE scp.space_id = 'c0000000-0000-4000-8000-000000000001'
ON CONFLICT (space_id) DO NOTHING;

-- Bookable hours Mon–Fri 7:00–18:00
INSERT INTO bookable_hours (space_id, weekday, start_minute, end_minute)
SELECT
  'c0000000-0000-4000-8000-000000000002',
  d,
  7 * 60,
  18 * 60
FROM generate_series(1, 5) AS d
ON CONFLICT ON CONSTRAINT bookable_hours_unique_window DO NOTHING;

-- Parking addon for room 2
INSERT INTO addons (
  id, space_id, name, description, price_cents, unit,
  requires_guest_fields, lead_time_hours, active
)
VALUES (
  'd0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002',
  'Parking',
  '$25/day reserved garage parking under the building. Provide guest emails/mobile numbers at least 24 hours ahead.',
  2500,
  'per_day',
  '["emails","phones"]'::jsonb,
  24,
  true
)
ON CONFLICT (id) DO NOTHING;

-- Amenities (same set as room 1)
INSERT INTO space_amenities (space_id, amenity_id)
SELECT 'c0000000-0000-4000-8000-000000000002', a.id
FROM amenities a
WHERE a.key IN (
  'wifi','tables','chairs','screen','whiteboard','monitor',
  'conference_phone','apple_tv','coffee','projector','printer',
  'restrooms','kitchen','wheelchair_accessible'
)
ON CONFLICT DO NOTHING;

-- House rules
INSERT INTO host_rules (space_id, body_md)
VALUES (
  'c0000000-0000-4000-8000-000000000002',
  $md$
- Leave the space as found; tidy up and remove equipment/rentals by end time
- No nails, screws, staples, tape, or gum-backed materials
- Furniture moves require advance notice
- No smoking, glitter/confetti, open flames, frying, or high-smoke cooking
- Overtime billed in 30-minute increments at 1.5× hourly rate
- Damages billed to the card on file
  $md$
)
ON CONFLICT (space_id) DO NOTHING;
