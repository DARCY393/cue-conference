-- Enums

CREATE TYPE user_role AS ENUM ('host', 'guest', 'admin');

CREATE TYPE space_status AS ENUM ('draft', 'live', 'paused');

CREATE TYPE addon_unit AS ENUM ('per_booking', 'per_day', 'per_item');

CREATE TYPE booking_status AS ENUM (
  'draft',
  'requested',
  'accepted',
  'declined',
  'expired',
  'cancelled',
  'in_progress',
  'completed'
);

-- Statuses that hold calendar inventory
-- requested | accepted | in_progress

CREATE TYPE payment_event_type AS ENUM (
  'authorize',
  'capture',
  'cancel_hold',
  'refund',
  'overtime_charge',
  'damage_charge'
);

CREATE TYPE message_channel AS ENUM ('email', 'sms');
