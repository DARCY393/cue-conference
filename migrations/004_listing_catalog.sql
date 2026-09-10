-- Listing content: photos, amenities, hours, blockouts, add-ons, policies, rules

CREATE TABLE space_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt         text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX space_photos_space_id_idx ON space_photos (space_id, sort_order);

CREATE TABLE amenities (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key   text NOT NULL UNIQUE, -- e.g. wifi, whiteboard
  label text NOT NULL
);

CREATE TABLE space_amenities (
  space_id    uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  amenity_id  uuid NOT NULL REFERENCES amenities (id) ON DELETE CASCADE,
  PRIMARY KEY (space_id, amenity_id)
);

-- weekday: 0=Sunday … 6=Saturday (Postgres EXTRACT(DOW))
-- minutes from local midnight in the space timezone
CREATE TABLE bookable_hours (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id      uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute  integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute    integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  CONSTRAINT bookable_hours_range CHECK (end_minute > start_minute),
  CONSTRAINT bookable_hours_unique_window UNIQUE (space_id, weekday, start_minute, end_minute)
);

CREATE INDEX bookable_hours_space_id_idx ON bookable_hours (space_id, weekday);

CREATE TABLE blockouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blockouts_range CHECK (ends_at > starts_at)
);

CREATE INDEX blockouts_space_time_idx ON blockouts (space_id, starts_at, ends_at);

-- Hard: no overlapping blockouts on the same space
ALTER TABLE blockouts
  ADD CONSTRAINT blockouts_no_overlap
  EXCLUDE USING gist (
    space_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  );

CREATE TABLE addons (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id                uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name                    text NOT NULL,
  description             text,
  price_cents             integer NOT NULL CHECK (price_cents >= 0),
  unit                    addon_unit NOT NULL DEFAULT 'per_booking',
  requires_guest_fields   jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- e.g. ["emails","phones"] for parking
  lead_time_hours         integer NOT NULL DEFAULT 0 CHECK (lead_time_hours >= 0),
  active                  boolean NOT NULL DEFAULT true,
  sort_order              integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX addons_space_active_idx ON addons (space_id) WHERE active;

CREATE TABLE cancellation_policies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  rules_json  jsonb NOT NULL,
  -- Example Flexible shape:
  -- {
  --   "full_refund_days_before": 7,
  --   "partial_refund_hours_before": 24,
  --   "partial_refund_bps": 5000,
  --   "partial_excludes_fees": true,
  --   "grace_hours_after_confirm": 24,
  --   "grace_requires_hours_before_start": 48
  -- }
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE space_cancellation_policies (
  space_id                 uuid PRIMARY KEY REFERENCES spaces (id) ON DELETE CASCADE,
  cancellation_policy_id   uuid NOT NULL REFERENCES cancellation_policies (id)
);

CREATE TABLE host_rules (
  space_id    uuid PRIMARY KEY REFERENCES spaces (id) ON DELETE CASCADE,
  body_md     text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE health_safety (
  space_id    uuid PRIMARY KEY REFERENCES spaces (id) ON DELETE CASCADE,
  body_md     text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
