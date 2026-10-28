-- Host decision reminders: when a request is still 'requested' 6h and 2h before its auto-decline
-- deadline, email HOST_EMAIL and text HOST_ALERT_SMS_TO. Each column is claimed (set) atomically
-- before the send so the 15-minute expire job never sends the same reminder twice.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS host_reminder_6h_sent_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS host_reminder_2h_sent_at timestamptz;
