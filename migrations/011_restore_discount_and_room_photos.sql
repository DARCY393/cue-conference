-- Restore the 20% long-booking discount (8+ total billable hours) and give
-- each Arts District room up to 3 gallery photos. Safe to re-run (guarded
-- UPDATE / NOT EXISTS inserts).

-- 1. Long-booking discount back on for all rooms; see docs/REMOVED_FEATURES.md.
UPDATE spaces SET long_booking_discount_bps = 2000, updated_at = now()
WHERE id IN (
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000004'
);

-- 2. Up to 3 photos per room (sort_order 0-2). Only fills slots that don't
-- already have a row, so a manually-curated photo is never overwritten.
INSERT INTO space_photos (space_id, url, alt, sort_order)
SELECT r.space_id, r.url, r.alt, r.sort_order
FROM (
  VALUES
    ('c0000000-0000-4000-8000-000000000001'::uuid, 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200', 'Meeting room', 0),
    ('c0000000-0000-4000-8000-000000000001'::uuid, 'https://images.unsplash.com/photo-1517502884422-41eaead166d4?w=1200', 'Meeting room seating', 1),
    ('c0000000-0000-4000-8000-000000000001'::uuid, 'https://images.unsplash.com/photo-1431540015161-0bf868a2d407?w=1200', 'Meeting room table', 2),

    ('c0000000-0000-4000-8000-000000000002'::uuid, 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200', 'Meeting room', 0),
    ('c0000000-0000-4000-8000-000000000002'::uuid, 'https://images.unsplash.com/photo-1517502884422-41eaead166d4?w=1200', 'Meeting room seating', 1),
    ('c0000000-0000-4000-8000-000000000002'::uuid, 'https://images.unsplash.com/photo-1431540015161-0bf868a2d407?w=1200', 'Meeting room table', 2),

    ('c0000000-0000-4000-8000-000000000003'::uuid, 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200', 'Meeting room', 0),
    ('c0000000-0000-4000-8000-000000000003'::uuid, 'https://images.unsplash.com/photo-1517502884422-41eaead166d4?w=1200', 'Meeting room seating', 1),
    ('c0000000-0000-4000-8000-000000000003'::uuid, 'https://images.unsplash.com/photo-1431540015161-0bf868a2d407?w=1200', 'Meeting room table', 2),

    ('c0000000-0000-4000-8000-000000000004'::uuid, 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200', 'Meeting room', 0),
    ('c0000000-0000-4000-8000-000000000004'::uuid, 'https://images.unsplash.com/photo-1517502884422-41eaead166d4?w=1200', 'Meeting room seating', 1),
    ('c0000000-0000-4000-8000-000000000004'::uuid, 'https://images.unsplash.com/photo-1431540015161-0bf868a2d407?w=1200', 'Meeting room table', 2)
) AS r (space_id, url, alt, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM space_photos existing
  WHERE existing.space_id = r.space_id AND existing.sort_order = r.sort_order
);

-- M2: use only "SPP - M2 Conference Room" for busy and write sync; drop "M2 - SPP".
UPDATE spaces SET google_busy_calendar_ids = '{}'
WHERE google_calendar_id = 'c_8b3363b1a13418a42df25d270780f453fa4f4e2de9be4b5d85bc3119ea23ff3a@group.calendar.google.com';
