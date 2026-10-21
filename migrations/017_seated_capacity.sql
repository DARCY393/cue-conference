-- M1 and M4: "Seats 8 (max 10)". spaces.capacity stays the maximum number of
-- people (the guest-count limit); the new seated_capacity is the comfortable
-- seated count shown alongside it. M2 (20) and M3 (5) are unchanged.
-- Idempotent.

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS seated_capacity integer
  CHECK (seated_capacity IS NULL OR (seated_capacity > 0 AND seated_capacity <= capacity));

UPDATE spaces
SET capacity = 10,
    seated_capacity = 8,
    subtitle = 'Seats 8 (max 10) · Cue Arts District',
    updated_at = now()
WHERE id IN ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004');
