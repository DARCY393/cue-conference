-- Seed Cue (Dallas) defaults — replace host email / private address before prod

INSERT INTO cancellation_policies (id, name, rules_json)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Flexible',
  '{
    "full_refund_days_before": 7,
    "partial_refund_hours_before": 24,
    "partial_refund_bps": 5000,
    "partial_excludes_fees": true,
    "grace_hours_after_confirm": 24,
    "grace_requires_hours_before_start": 48
  }'::jsonb
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO users (id, role, name, email)
VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'host',
  'Darcy Y.',
  'host@example.com'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO spaces (
  id, host_id, slug, title, subtitle, description,
  city, neighborhood, timezone, capacity, status,
  min_hours, base_hourly_cents, overtime_multiplier,
  long_booking_threshold_hours, long_booking_discount_bps,
  cleaning_included, address_private
)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'cue-dallas',
  'Cue',
  'Bright 10 Person Conference Room in Dallas',
  'Private conference room for presentations, team meetings, workshops, and brainstorming.',
  'Dallas',
  'Dallas Downtown Historic District',
  'America/Chicago',
  10,
  'live',
  1,
  7000,
  1.50,
  8,
  2000,
  true,
  'REDACTED — reveal after accept'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO space_cancellation_policies (space_id, cancellation_policy_id)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (space_id) DO NOTHING;

-- Mon–Fri 7:00–18:00 (DOW 1–5)
INSERT INTO bookable_hours (space_id, weekday, start_minute, end_minute)
SELECT
  'c0000000-0000-4000-8000-000000000001',
  d,
  7 * 60,
  18 * 60
FROM generate_series(1, 5) AS d
ON CONFLICT ON CONSTRAINT bookable_hours_unique_window DO NOTHING;

INSERT INTO addons (
  id, space_id, name, description, price_cents, unit,
  requires_guest_fields, lead_time_hours, active
)
VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'Parking',
  '$25/day reserved garage parking under the building. Provide guest emails/mobile numbers at least 24 hours ahead.',
  2500,
  'per_day',
  '["emails","phones"]'::jsonb,
  24,
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO amenities (key, label) VALUES
  ('wifi', 'Wi-Fi'),
  ('tables', 'Tables'),
  ('chairs', 'Chairs'),
  ('screen', 'Screen'),
  ('whiteboard', 'Whiteboard'),
  ('monitor', 'Monitor'),
  ('conference_phone', 'Conference phone'),
  ('apple_tv', 'Apple TV'),
  ('coffee', 'Coffee'),
  ('projector', 'Projector'),
  ('printer', 'Printer'),
  ('restrooms', 'Restrooms'),
  ('kitchen', 'Kitchen'),
  ('wheelchair_accessible', 'Wheelchair accessible')
ON CONFLICT (key) DO NOTHING;

INSERT INTO space_amenities (space_id, amenity_id)
SELECT 'c0000000-0000-4000-8000-000000000001', a.id
FROM amenities a
WHERE a.key IN (
  'wifi','tables','chairs','screen','whiteboard','monitor',
  'conference_phone','apple_tv','coffee','projector','printer',
  'restrooms','kitchen','wheelchair_accessible'
)
ON CONFLICT DO NOTHING;

INSERT INTO host_rules (space_id, body_md)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
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
