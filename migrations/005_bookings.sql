-- Bookings, line items, inventory exclusion

CREATE TABLE bookings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id                  uuid NOT NULL REFERENCES spaces (id),
  guest_id                  uuid NOT NULL REFERENCES users (id),
  status                    booking_status NOT NULL DEFAULT 'draft',
  starts_at                 timestamptz NOT NULL,
  ends_at                   timestamptz NOT NULL,
  guest_notes               text,
  activity_description      text,
  quote_json                jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency                  char(3) NOT NULL DEFAULT 'usd',
  subtotal_cents            integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents            integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  addons_cents              integer NOT NULL DEFAULT 0 CHECK (addons_cents >= 0),
  fees_cents                integer NOT NULL DEFAULT 0 CHECK (fees_cents >= 0),
  tax_cents                 integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents               integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  cancellation_policy_id    uuid REFERENCES cancellation_policies (id),
  requested_at              timestamptz,
  host_action_deadline_at   timestamptz,
  decided_at                timestamptz,
  cancelled_at              timestamptz,
  completed_at              timestamptz,
  stripe_payment_intent_id  text UNIQUE,
  stripe_charge_id          text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_range CHECK (ends_at > starts_at),
  CONSTRAINT bookings_totals CHECK (
    total_cents = subtotal_cents - discount_cents + addons_cents + fees_cents + tax_cents
  )
);

CREATE INDEX bookings_space_time_idx ON bookings (space_id, starts_at, ends_at);
CREATE INDEX bookings_guest_id_idx ON bookings (guest_id);
CREATE INDEX bookings_host_queue_idx
  ON bookings (status, host_action_deadline_at)
  WHERE status = 'requested';
CREATE INDEX bookings_space_status_idx ON bookings (space_id, status);

-- Soft-hold + confirmed inventory cannot overlap
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    space_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('requested', 'accepted', 'in_progress'));

CREATE TABLE booking_addons (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  addon_id          uuid NOT NULL REFERENCES addons (id),
  quantity          integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  meta_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT booking_addons_unique UNIQUE (booking_id, addon_id)
);

CREATE INDEX booking_addons_booking_id_idx ON booking_addons (booking_id);

-- Optional: prevent guest double-submitting identical window while one is open
CREATE UNIQUE INDEX bookings_one_open_request_per_guest_slot
  ON bookings (space_id, guest_id, starts_at, ends_at)
  WHERE status IN ('draft', 'requested');
