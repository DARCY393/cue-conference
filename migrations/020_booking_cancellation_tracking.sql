-- Guest self-cancel + staff cancel: record what a cancellation did, and make it idempotent.
--   cancel_claimed_at: set atomically by the first cancel request before any Stripe call, so a
--     double click / concurrent staff+guest cancel can't refund twice (stale claims expire).
--   refund_cents / stripe_refund_id / cancellation_action / cancelled_by: the outcome, shown on
--     the guest's cancel page and the host screen. Additive and nullable; idempotent.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_claimed_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_cents integer;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_refund_id text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_action text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by text;
