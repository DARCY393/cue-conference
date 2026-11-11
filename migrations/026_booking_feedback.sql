-- The migration timestamp is a durable no-backfill cutoff, independent of env changes.
CREATE TABLE IF NOT EXISTS feedback_rollout (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO feedback_rollout (singleton) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS feedback_request_sent_at timestamptz;
CREATE TABLE IF NOT EXISTS booking_feedback (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  host_notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS bookings_feedback_due_idx ON bookings (ends_at)
  WHERE status = 'completed' AND feedback_request_sent_at IS NULL;
