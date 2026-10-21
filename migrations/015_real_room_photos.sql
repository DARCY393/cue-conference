-- Replace the Unsplash placeholder gallery with D'Arcy's real Cue Arts District
-- photos. Each room leads with its own shot(s), then the three shared general
-- shots (kitchenette, lounge, common area). Images live in public/images/rooms/.
-- Safe to re-run: it removes only the known placeholder URLs and this file's own
-- URLs for M1-M4 before inserting, so other manually-added photos are kept.

DELETE FROM space_photos
WHERE space_id IN (
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000004'
)
AND (url LIKE 'https://images.unsplash.com/%' OR url LIKE '/images/rooms/%');

INSERT INTO space_photos (space_id, url, alt, sort_order)
SELECT r.space_id, r.url, r.alt, r.sort_order
FROM (
  VALUES
    ('c0000000-0000-4000-8000-000000000001'::uuid, '/images/rooms/m1-meeting-room.jpg', 'M1 Meeting Room seen through its glass door, with a conference table and chairs', 0),
    ('c0000000-0000-4000-8000-000000000002'::uuid, '/images/rooms/m2-conference-room.jpg', 'M2 Conference Room behind a glass wall, with a long conference table seating 20', 0),
    ('c0000000-0000-4000-8000-000000000003'::uuid, '/images/rooms/m3-meeting-room.jpg', 'M3 Meeting Room with a table for five and a wall-mounted screen on a navy accent wall', 0),
    ('c0000000-0000-4000-8000-000000000003'::uuid, '/images/rooms/m3-meeting-room-screen.jpg', 'M3 Meeting Room through the glass door, with the TV on the navy wall', 1),
    ('c0000000-0000-4000-8000-000000000004'::uuid, '/images/rooms/m4-meeting-room.jpg', 'M4 Meeting Room seen through its glass wall, with a conference table and chairs', 0)
) AS r (space_id, url, alt, sort_order);

-- Shared general shots after each room's own photo(s).
INSERT INTO space_photos (space_id, url, alt, sort_order)
SELECT s.space_id, g.url, g.alt, s.own_count + g.idx
FROM (
  VALUES
    ('c0000000-0000-4000-8000-000000000001'::uuid, 1),
    ('c0000000-0000-4000-8000-000000000002'::uuid, 1),
    ('c0000000-0000-4000-8000-000000000003'::uuid, 2),
    ('c0000000-0000-4000-8000-000000000004'::uuid, 1)
) AS s (space_id, own_count)
CROSS JOIN (
  VALUES
    ('/images/rooms/cue-kitchenette.jpg', 'Cue kitchenette with coffee machine, counter seating and a high-top table', 0),
    ('/images/rooms/cue-lounge.jpg', 'Cue lounge sitting area with a sofa, armchairs and coffee tables', 1),
    ('/images/rooms/cue-common-area.jpg', 'Open common area at Cue Arts District with lounge seating and the Cue moss wall sign', 2)
) AS g (url, alt, idx)
WHERE EXISTS (SELECT 1 FROM spaces WHERE spaces.id = s.space_id);
