-- Rename M2 from "M2 Meeting Room" to "M2 Conference Room". short_title stays "M2".
-- Photo alt text already says "M2 Conference Room" (migration 015). Idempotent.

UPDATE spaces
SET title = 'M2 Conference Room',
    updated_at = now()
WHERE id = 'c0000000-0000-4000-8000-000000000002'
  AND title IS DISTINCT FROM 'M2 Conference Room';
