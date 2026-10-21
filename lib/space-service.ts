import { CUE_SPACE, CUE_SPACES, CUE_LOCATIONS, IDS, resolveLegacySpaceSlug } from "./seed";
import { getStore, isDemoMode } from "./store";
import { query } from "./db";
import type { BusyInterval, LocationPublic, SpacePublic } from "./types";
import { CANCELLATION_RULES } from "./seed";
import { MAX_GALLERY_PHOTOS, toPublicSpaceJson } from "./space-public";

type SpaceRow = {
  id: string;
  slug: string;
  title: string;
  short_title: string | null;
  subtitle: string | null;
  description: string | null;
  city: string;
  neighborhood: string | null;
  timezone: string;
  capacity: number;
  seated_capacity: number | null;
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
  location_id: string | null;
  loc_slug: string | null;
  loc_name: string | null;
  loc_city: string | null;
  loc_neighborhood: string | null;
  loc_address_public: string | null;
  loc_timezone: string | null;
  google_calendar_id: string | null;
  google_busy_calendar_ids: string[] | null;
};

/** Fallback for rows with no short_title: use the title's first word (e.g. "M2 Conference Room" -> "M2"). */
function deriveShortTitle(title: string): string {
  return title.split(" ")[0] || title;
}

async function hydrateSpace(s: SpaceRow): Promise<SpacePublic> {
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
      `SELECT url, alt, sort_order FROM space_photos WHERE space_id = $1 ORDER BY sort_order LIMIT $2`,
      [s.id, MAX_GALLERY_PHOTOS]
    ),
  ]);

  const location: LocationPublic | undefined =
    s.location_id && s.loc_slug && s.loc_name && s.loc_city
      ? {
          id: s.location_id,
          slug: s.loc_slug,
          name: s.loc_name,
          city: s.loc_city,
          neighborhood: s.loc_neighborhood ?? undefined,
          addressPublic: s.loc_address_public ?? undefined,
          timezone: s.loc_timezone ?? undefined,
        }
      : undefined;

  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    shortTitle: s.short_title ?? deriveShortTitle(s.title),
    subtitle: s.subtitle ?? undefined,
    description: s.description ?? undefined,
    city: s.city,
    neighborhood: s.neighborhood ?? undefined,
    timezone: s.timezone,
    capacity: s.capacity,
    seatedCapacity: s.seated_capacity ?? undefined,
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
      requiresGuestFields: Array.isArray(a.requires_guest_fields)
        ? a.requires_guest_fields
        : typeof a.requires_guest_fields === "string"
          ? (JSON.parse(a.requires_guest_fields) as string[])
          : [],
    })),
    hostRulesMd: s.host_rules ?? undefined,
    cancellationPolicy: s.policy_name
      ? {
          name: s.policy_name,
          rules: (s.rules_json as import("./types").CancellationRules) ?? CANCELLATION_RULES,
        }
      : { name: "Standard", rules: CANCELLATION_RULES },
    approxLocation:
      s.approx_lat != null && s.approx_lng != null
        ? { lat: s.approx_lat, lng: s.approx_lng }
        : undefined,
    host: { name: s.host_name },
    location,
    locationId: s.location_id ?? undefined,
    googleCalendarId: s.google_calendar_id ?? undefined,
    googleBusyCalendarIds: s.google_busy_calendar_ids ?? [],
  };
}

const SPACE_SELECT = `
  SELECT s.*, u.name AS host_name, cp.name AS policy_name, cp.rules_json,
         hr.body_md AS host_rules,
         l.slug AS loc_slug, l.name AS loc_name, l.city AS loc_city,
         l.neighborhood AS loc_neighborhood, l.address_public AS loc_address_public,
         l.timezone AS loc_timezone
  FROM spaces s
  JOIN users u ON u.id = s.host_id
  LEFT JOIN locations l ON l.id = s.location_id
  LEFT JOIN space_cancellation_policies scp ON scp.space_id = s.id
  LEFT JOIN cancellation_policies cp ON cp.id = scp.cancellation_policy_id
  LEFT JOIN host_rules hr ON hr.space_id = s.id
`;

/** Public lookup — calendar sync internals are stripped (see toPublicSpaceJson). */
export async function getSpaceBySlug(slug: string): Promise<SpacePublic | null> {
  if (isDemoMode()) return getStore().getSpaceBySlug(slug);

  const { rows } = await query<SpaceRow>(
    `${SPACE_SELECT} WHERE s.slug = $1 AND s.status = 'live'`,
    [slug]
  );
  if (rows[0]) return toPublicSpaceJson(await hydrateSpace(rows[0]));

  const canonical = resolveLegacySpaceSlug(slug);
  if (canonical !== slug) {
    const { rows: legacyRows } = await query<SpaceRow>(
      `${SPACE_SELECT} WHERE s.slug = $1 AND s.status = 'live'`,
      [canonical]
    );
    if (legacyRows[0]) return toPublicSpaceJson(await hydrateSpace(legacyRows[0]));
  }
  return null;
}

/** Private/internal lookup — includes calendar sync fields; never serialize directly to a public response. */
export async function getSpaceById(id: string): Promise<SpacePublic | null> {
  if (isDemoMode()) return getStore().getSpaceById(id);
  const { rows } = await query<SpaceRow>(`${SPACE_SELECT} WHERE s.id = $1`, [id]);
  if (!rows[0]) return null;
  return hydrateSpace(rows[0]);
}

/** Public listing — calendar sync internals are stripped (see toPublicSpaceJson). */
export async function listSpaces(): Promise<SpacePublic[]> {
  if (isDemoMode()) return getStore().listSpaces();

  const { rows } = await query<SpaceRow>(
    `${SPACE_SELECT}
     WHERE s.status = 'live'
     ORDER BY COALESCE(l.sort_order, 0), l.name NULLS LAST, s.title`
  );
  const out: SpacePublic[] = [];
  for (const row of rows) {
    out.push(toPublicSpaceJson(await hydrateSpace(row)));
  }
  return out;
}

export async function listLocationsWithSpaces(): Promise<
  { location: LocationPublic; spaces: SpacePublic[] }[]
> {
  const spaces = await listSpaces();
  if (isDemoMode()) {
    return CUE_LOCATIONS.map((loc) => ({
      location: loc,
      spaces: spaces.filter((s) => s.location?.id === loc.id),
    }));
  }

  const { rows } = await query<{
    id: string;
    slug: string;
    name: string;
    city: string;
    neighborhood: string | null;
    address_public: string | null;
    timezone: string | null;
    sort_order: number;
  }>(
    `SELECT id, slug, name, city, neighborhood, address_public, timezone, sort_order
     FROM locations ORDER BY sort_order, name`
  );

  const byLoc = new Map<string, SpacePublic[]>();
  for (const s of spaces) {
    const key = s.location?.id ?? "_none";
    if (!byLoc.has(key)) byLoc.set(key, []);
    byLoc.get(key)!.push(s);
  }

  const groups: { location: LocationPublic; spaces: SpacePublic[] }[] = rows.map(
    (r) => ({
      location: {
        id: r.id,
        slug: r.slug,
        name: r.name,
        city: r.city,
        neighborhood: r.neighborhood ?? undefined,
        addressPublic: r.address_public ?? undefined,
        timezone: r.timezone ?? undefined,
      },
      spaces: byLoc.get(r.id) ?? [],
    })
  );

  const orphans = byLoc.get("_none");
  if (orphans?.length) {
    groups.push({
      location: {
        id: "_none",
        slug: "unassigned",
        name: "Other spaces",
        city: orphans[0].city,
      },
      spaces: orphans,
    });
  }
  return groups;
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

export { CUE_SPACE, CUE_SPACES, CUE_LOCATIONS, IDS };
export { toPublicSpaceJson } from "./space-public";
