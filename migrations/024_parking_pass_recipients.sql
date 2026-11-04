-- Parking pass recipients: after a booking with parking is accepted, the guest tells us who
-- gets each pass (mobile number or email) so staff can issue gate QR codes in Honeycomb.
CREATE TABLE IF NOT EXISTS parking_pass_recipients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  position    integer NOT NULL CHECK (position >= 1 AND position <= 20),
  phone       text,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parking_pass_recipients_contact CHECK (phone IS NOT NULL OR email IS NOT NULL),
  UNIQUE (booking_id, position)
);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS parking_request_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS parking_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS parking_recipients_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS bookings_parking_reminder_due_idx
  ON bookings (starts_at)
  WHERE status = 'accepted' AND parking_passes > 0 AND parking_reminder_sent_at IS NULL;

-- Staff mark passes issued (done by hand in Parkonect); host gets a 24h-before status email.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS parking_passes_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS parking_passes_issued_by text,
  ADD COLUMN IF NOT EXISTS parking_issued_note text,
  ADD COLUMN IF NOT EXISTS parking_host_status_sent_at timestamptz;
