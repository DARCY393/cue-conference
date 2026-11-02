-- Pre-booking questions from prospective renters ("Ask a question" on each room page).
CREATE TABLE IF NOT EXISTS inquiries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_slug     text,
  space_title    text,
  name           text NOT NULL,
  email          text NOT NULL,
  phone          text,
  preferred_date date,
  message        text NOT NULL,
  ip_hash        text NOT NULL,
  spam_verdict   text NOT NULL DEFAULT 'ok',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inquiries_created_idx ON inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS inquiries_ip_idx ON inquiries (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS inquiries_email_idx ON inquiries (lower(email), created_at DESC);
