-- Delivery log: every email/text the app attempts lands in message_logs.
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent';
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS error text;
DO $$ BEGIN
  ALTER TABLE message_logs ADD CONSTRAINT message_logs_status_check CHECK (status IN ('sent','failed','skipped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS message_logs_sent_at_idx ON message_logs (sent_at DESC);
-- Completed-booking sweep
CREATE INDEX IF NOT EXISTS bookings_accepted_ends_idx ON bookings (ends_at) WHERE status = 'accepted';
