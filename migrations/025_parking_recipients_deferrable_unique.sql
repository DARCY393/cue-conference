-- Guests update their parking list by replacing all rows in one statement
-- (DELETE ... + INSERT in a CTE). A plain UNIQUE (booking_id, position) is checked
-- row by row and sees the not-yet-deleted rows, so any update failed with 23505.
-- Make it DEFERRABLE INITIALLY DEFERRED so it is checked at commit instead.
ALTER TABLE parking_pass_recipients
  DROP CONSTRAINT IF EXISTS parking_pass_recipients_booking_id_position_key;
ALTER TABLE parking_pass_recipients
  ADD CONSTRAINT parking_pass_recipients_booking_id_position_key
  UNIQUE (booking_id, position) DEFERRABLE INITIALLY DEFERRED;
