-- Bookings start as 'draft' when the guest clicks "Continue to payment" and only
-- become 'requested' (host alert + guest email) once Stripe reports the card hold
-- as authorized. client_request_key makes the create call idempotent per form
-- submission (double clicks / retries return the same draft). Safe to re-run.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_request_key text;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_client_request_key_uidx
  ON bookings (client_request_key)
  WHERE client_request_key IS NOT NULL;

-- Expiry sweep for abandoned drafts (never authorized).
CREATE INDEX IF NOT EXISTS bookings_draft_created_idx
  ON bookings (created_at)
  WHERE status = 'draft';
