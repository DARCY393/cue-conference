-- Dedicated parking-passes pricing (separate from the deactivated generic
-- "Parking" addon rows — see docs/REMOVED_FEATURES.md) + 24h reminder emails.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS parking_passes integer NOT NULL DEFAULT 0
    CHECK (parking_passes >= 0 AND parking_passes <= 20),
  ADD COLUMN IF NOT EXISTS parking_cents integer NOT NULL DEFAULT 0
    CHECK (parking_cents >= 0),
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_totals;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_totals CHECK (
    total_cents = subtotal_cents - discount_cents + addons_cents + parking_cents + fees_cents + tax_cents
  );

-- Reminder-cron scan: accepted bookings starting soon that haven't been reminded yet.
CREATE INDEX IF NOT EXISTS bookings_reminder_due_idx
  ON bookings (starts_at)
  WHERE status = 'accepted' AND reminder_sent_at IS NULL;
