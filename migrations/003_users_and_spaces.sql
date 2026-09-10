-- Users and spaces

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role                user_role NOT NULL DEFAULT 'guest',
  name                text NOT NULL,
  email               text,
  phone               text,
  stripe_customer_id  text UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX users_email_unique
  ON users (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE spaces (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id                       uuid NOT NULL REFERENCES users (id),
  slug                          text NOT NULL,
  title                         text NOT NULL,
  subtitle                      text,
  description                   text,
  city                          text NOT NULL,
  neighborhood                  text,
  timezone                      text NOT NULL DEFAULT 'America/Chicago',
  capacity                      integer NOT NULL CHECK (capacity > 0),
  status                        space_status NOT NULL DEFAULT 'draft',
  min_hours                     numeric(6,2) NOT NULL DEFAULT 1
                                CHECK (min_hours > 0),
  base_hourly_cents             integer NOT NULL CHECK (base_hourly_cents >= 0),
  overtime_multiplier           numeric(4,2) NOT NULL DEFAULT 1.50
                                CHECK (overtime_multiplier >= 1),
  long_booking_threshold_hours  numeric(6,2) NOT NULL DEFAULT 8
                                CHECK (long_booking_threshold_hours > 0),
  long_booking_discount_bps     integer NOT NULL DEFAULT 2000
                                CHECK (long_booking_discount_bps BETWEEN 0 AND 10000),
  cleaning_included             boolean NOT NULL DEFAULT true,
  approx_lat                    double precision,
  approx_lng                    double precision,
  address_private               text, -- only revealed after accept
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spaces_slug_unique UNIQUE (slug)
);

CREATE INDEX spaces_host_id_idx ON spaces (host_id);
CREATE INDEX spaces_status_idx ON spaces (status);
