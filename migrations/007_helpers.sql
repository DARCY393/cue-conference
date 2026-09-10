-- updated_at trigger + overlap helpers for the app layer

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER spaces_set_updated_at
  BEFORE UPDATE ON spaces
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER addons_set_updated_at
  BEFORE UPDATE ON addons
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER bookings_set_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- True if [starts_at, ends_at) conflicts with an active booking or blockout
CREATE OR REPLACE FUNCTION space_is_available(
  p_space_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM bookings b
    WHERE b.space_id = p_space_id
      AND b.status IN ('requested', 'accepted', 'in_progress')
      AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
      AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM blockouts x
    WHERE x.space_id = p_space_id
      AND tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  );
$$;

-- Local-time bookable-hours check (space timezone)
CREATE OR REPLACE FUNCTION space_within_bookable_hours(
  p_space_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz text;
  v_start_local timestamp;
  v_end_local timestamp;
  v_dow integer;
  v_start_min integer;
  v_end_min integer;
BEGIN
  IF p_ends_at <= p_starts_at THEN
    RETURN false;
  END IF;

  SELECT timezone INTO v_tz FROM spaces WHERE id = p_space_id;
  IF v_tz IS NULL THEN
    RETURN false;
  END IF;

  v_start_local := p_starts_at AT TIME ZONE v_tz;
  v_end_local   := p_ends_at   AT TIME ZONE v_tz;

  -- Multi-day windows: require every local calendar day covered (MVP = same day)
  IF v_start_local::date <> (v_end_local - interval '1 second')::date THEN
    RETURN false;
  END IF;

  v_dow := EXTRACT(DOW FROM v_start_local)::integer;
  v_start_min := (EXTRACT(HOUR FROM v_start_local)::integer * 60)
               + EXTRACT(MINUTE FROM v_start_local)::integer;
  v_end_min := (EXTRACT(HOUR FROM v_end_local)::integer * 60)
             + EXTRACT(MINUTE FROM v_end_local)::integer;
  -- treat exact midnight end-of-day as 1440 when needed
  IF v_end_min = 0 AND v_end_local::time = time '00:00' THEN
    v_end_min := 1440;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM bookable_hours h
    WHERE h.space_id = p_space_id
      AND h.weekday = v_dow
      AND v_start_min >= h.start_minute
      AND v_end_min   <= h.end_minute
  );
END;
$$;
