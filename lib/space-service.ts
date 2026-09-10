import { CUE_SPACE, IDS } from "./seed";
import { getStore, isDemoMode } from "./store";
import { query } from "./db";
import type { BusyInterval, SpacePublic } from "./types";
import { FLEXIBLE_RULES } from "./seed";

export async function getSpaceBySlug(slug: string): Promise<SpacePublic | null> {
  if (isDemoMode()) return getStore().getSpaceBySlug(slug);

  const { rows } = await query<{
    id: string;
    slug: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    city: string;
    neighborhood: string | null;
    timezone: string;
    capacity: number;
    status: string;
    min_hours: string;
    base_hourly_cents: number;
    overtime_multiplier: string;
    long_booking_threshold_hours: string;
    long_booking_discount_bps: number;
    cleaning_included: boolean;
    approx_lat: number | null;
    approx_lng: number | null;
    host_name: string;
    policy_name: string | null;
    rules_json: unknown;
    host_rules: string | null;
  }>(
    `SELECT s.*, u.name AS host_name, cp.name AS policy_name, cp.rules_json,
            hr.body_md AS host_rules
     FROM spaces s
     JOIN users u ON u.id = s.host_id
     LEFT JOIN space_cancellation_policies scp ON scp.space_id = s.id
     LEFT JOIN cancellation_policies cp ON cp.id = scp.cancellation_policy_id
     LEFT JOIN host_rules hr ON hr.space_id = s.id
     WHERE s.slug = $1 AND s.status = 'live'`,
    [slug]
  );
  if (!rows[0]) return null;
  const s = rows[0];

  const [hours, amenities, addons, photos] = await Promise.all([
    query<{ weekday: number; start_minute: number; end_minute: number }>(
      `SELECT weekday, start_minute, end_minute FROM bookable_hours WHERE space_id = $1`,
      [s.id]
    ),
    query<{ key: string; label: string }>(
      `SELECT a.key, a.label FROM space_amenities sa JOIN amenities a ON a.id = sa.amenity_id WHERE sa.space_id = $1`,
      [s.id]
    ),
    query<{
      id: string;
      name: string;
      description: string | null;
      price_cents: number;
      unit: string;
      lead_time_hours: number;
      requires_guest_fields: string[];
    }>(
      `SELECT id, name, description, price_cents, unit, lead_time_hours, requires_guest_fields
       FROM addons WHERE space_id = $1 AND active = true ORDER BY sort_order`,
      [s.id]
    ),
    query<{ url: string; alt: string | null; sort_order: number }>(
      `SELECT url, alt, sort_order FROM space_photos WHERE space_id = $1 ORDER BY sort_order`,
      [s.id]
    ),
  ]);

  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    subtitle: s.subtitle ?? undefined,
    description: s.description ?? undefined,
    city: s.city,
    neighborhood: s.neighborhood ?? undefined,
    timezone: s.timezone,
    capacity: s.capacity,
    status: s.status as SpacePublic["status"],
    pricing: {
      currency: "usd",
      baseHourlyCents: s.base_hourly_cents,
      minHours: Number(s.min_hours),
      longBookingThresholdHours: Number(s.long_booking_threshold_hours),
      longBookingDiscountBps: s.long_booking_discount_bps,
      overtimeMultiplier: Number(s.overtime_multiplier),
      cleaningIncluded: s.cleaning_included,
    },
    bookableHours: hours.rows.map((h) => ({
      weekday: h.weekday,
      startMinute: h.start_minute,
      endMinute: h.end_minute,
    })),
    photos: photos.rows.map((p) => ({
      url: p.url,
      alt: p.alt ?? undefined,
      sortOrder: p.sort_order,
    })),
    amenities: amenities.rows,
    addons: addons.rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description ?? undefined,
      priceCents: a.price_cents,
      unit: a.unit as SpacePublic["addons"][0]["unit"],
      leadTimeHours: a.lead_time_hours,
      requiresGuestFields: a.requires_guest_fields,
    })),
    hostRulesMd: s.host_rules ?? undefined,
    cancellationPolicy: s.policy_name
      ? {
          name: s.policy_name,
          rules: (s.rules_json as SpacePublic["cancellationPolicy"])!.rules,
        }
      : { name: "Flexible", rules: FLEXIBLE_RULES },
    approxLocation:
      s.approx_lat != null && s.approx_lng != null
        ? { lat: s.approx_lat, lng: s.approx_lng }
        : undefined,
    host: { name: s.host_name },
  };
}

export async function getSpaceById(id: string): Promise<SpacePublic | null> {
  if (isDemoMode()) return getStore().getSpaceById(id);
  // Reuse slug path via id lookup
  const { rows } = await query<{ slug: string }>(
    `SELECT slug FROM spaces WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  return getSpaceBySlug(rows[0].slug);
}

export async function getBusy(
  spaceId: string,
  from: Date,
  to: Date
): Promise<BusyInterval[]> {
  if (isDemoMode()) {
    return getStore()
      .getBusy(spaceId)
      .filter(
        (b) =>
          new Date(b.startsAt) < to && new Date(b.endsAt) > from
      );
  }
  const bookings = await query<{ starts_at: Date; ends_at: Date }>(
    `SELECT starts_at, ends_at FROM bookings
     WHERE space_id = $1
       AND status IN ('requested','accepted','in_progress')
       AND starts_at < $3 AND ends_at > $2`,
    [spaceId, from.toISOString(), to.toISOString()]
  );
  const blockouts = await query<{ starts_at: Date; ends_at: Date }>(
    `SELECT starts_at, ends_at FROM blockouts
     WHERE space_id = $1 AND starts_at < $3 AND ends_at > $2`,
    [spaceId, from.toISOString(), to.toISOString()]
  );
  return [
    ...bookings.rows.map((b) => ({
      startsAt: new Date(b.starts_at).toISOString(),
      endsAt: new Date(b.ends_at).toISOString(),
      kind: "booking" as const,
    })),
    ...blockouts.rows.map((b) => ({
      startsAt: new Date(b.starts_at).toISOString(),
      endsAt: new Date(b.ends_at).toISOString(),
      kind: "blockout" as const,
    })),
  ];
}

export { CUE_SPACE, IDS };
