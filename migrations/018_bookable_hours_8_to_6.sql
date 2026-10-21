-- Bookable hours become Mon–Fri 8:00–18:00 America/Chicago (was 7:00–18:00) for M1–M4.
-- Replaces each room's windows with exactly one 08:00–18:00 window per weekday (DOW 1–5).
-- Existing bookings are not touched. Idempotent.

DELETE FROM bookable_hours
WHERE space_id IN (
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000004'
);

INSERT INTO bookable_hours (space_id, weekday, start_minute, end_minute)
SELECT s.id, d, 8 * 60, 18 * 60
FROM spaces s
CROSS JOIN generate_series(1, 5) AS d
WHERE s.id IN (
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000004'
)
ON CONFLICT ON CONSTRAINT bookable_hours_unique_window DO NOTHING;
