-- D'Arcy's new cancellation policy: free cancellation up to 48h before start,
-- no refund after. Replaces the old tiered "Flexible" (grace/7-day/24h-partial)
-- policy for these bookings — everyone is a non-member.
UPDATE cancellation_policies
SET name = 'Standard',
    rules_json = '{"free_cancellation_hours_before": 48}'::jsonb
WHERE id = 'a0000000-0000-4000-8000-000000000001';
