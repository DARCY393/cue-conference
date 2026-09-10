-- Payment ledger + outbound message log

CREATE TABLE payment_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  type              payment_event_type NOT NULL,
  amount_cents      integer NOT NULL CHECK (amount_cents >= 0),
  currency          char(3) NOT NULL DEFAULT 'usd',
  stripe_object_id  text,
  idempotency_key   text UNIQUE,
  raw_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_events_booking_id_idx ON payment_events (booking_id, created_at);

CREATE TABLE message_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid REFERENCES bookings (id) ON DELETE SET NULL,
  channel       message_channel NOT NULL,
  template      text NOT NULL,
  to_address    text NOT NULL,
  provider_id   text,
  payload_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_logs_booking_id_idx ON message_logs (booking_id);
