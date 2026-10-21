import { capacityLabel } from "./format";
import type { AddonPublic, CancellationRules, LocationPublic, SpacePricing, SpacePublic } from "./types";
import { CANCELLATION_DEFAULT } from "./refund";
import { FEATURES } from "./features";

export const IDS = {
  policy: "a0000000-0000-4000-8000-000000000001",
  host: "b0000000-0000-4000-8000-000000000001",
  m1: "c0000000-0000-4000-8000-000000000001",
  m2: "c0000000-0000-4000-8000-000000000002",
  m3: "c0000000-0000-4000-8000-000000000003",
  m4: "c0000000-0000-4000-8000-000000000004",
  parkingM1: "d0000000-0000-4000-8000-000000000001",
  parkingM2: "d0000000-0000-4000-8000-000000000002",
  location: "e0000000-0000-4000-8000-000000000001",
} as const;

/** @deprecated use IDS.m1/m2/m3/m4 */
export const SPACE_IDS = { space: IDS.m1, space2: IDS.m2 };

export const CANCELLATION_RULES: CancellationRules = { ...CANCELLATION_DEFAULT };

export const CUE_LOCATION: LocationPublic = {
  id: IDS.location,
  slug: "arts-district",
  name: "Cue Arts District",
  city: "Dallas",
  neighborhood: "Arts District",
  addressPublic: "750 N. St. Paul Street, Dallas, TX 75201",
  timezone: "America/Chicago",
};

/** Legacy location slugs that must keep resolving to the renamed location. */
const LOCATION_SLUG_ALIASES: Record<string, string> = {
  "downtown-arts-district": CUE_LOCATION.slug,
};

export function resolveLocationSlug(slug: string): string {
  return LOCATION_SLUG_ALIASES[slug] ?? slug;
}

export function getLocationBySlug(slug: string): LocationPublic | null {
  const canonical = resolveLocationSlug(slug);
  return CUE_LOCATIONS.find((l) => l.slug === canonical) ?? null;
}

/** Legacy room slugs that must keep resolving to the current room. */
const LEGACY_SPACE_SLUGS: Record<string, string> = {
  "cue-dallas": "arts-district-m1",
};

export function resolveLegacySpaceSlug(slug: string): string {
  return LEGACY_SPACE_SLUGS[slug] ?? slug;
}

const SHARED_AMENITIES = [
  { key: "wifi", label: "Wi-Fi" },
  { key: "tables", label: "Tables" },
  { key: "chairs", label: "Chairs" },
  { key: "screen", label: "Screen" },
  { key: "whiteboard", label: "Whiteboard" },
  { key: "monitor", label: "Monitor" },
  { key: "conference_phone", label: "Conference phone" },
  { key: "apple_tv", label: "Apple TV" },
  { key: "coffee", label: "Coffee" },
  { key: "projector", label: "Projector" },
  { key: "printer", label: "Printer" },
  { key: "restrooms", label: "Restrooms" },
  { key: "kitchen", label: "Kitchen" },
  { key: "wheelchair_accessible", label: "Wheelchair accessible" },
];

const SHARED_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 7 * 60,
  endMinute: 18 * 60,
}));

/** Default hourly rate for new rooms; configurable per room via pricing.baseHourlyCents. */
export const DEFAULT_HOURLY_CENTS = 7000;

/** Default minimum booking length, in hours; configurable per room via pricing.minHours. */
export const DEFAULT_MIN_HOURS = 1;

const ROOM_PRICING: SpacePricing = {
  currency: "usd",
  baseHourlyCents: DEFAULT_HOURLY_CENTS,
  minHours: DEFAULT_MIN_HOURS,
  longBookingThresholdHours: 8,
  // 20% off the whole reservation at 8+ total billable hours; see docs/REMOVED_FEATURES.md.
  longBookingDiscountBps: 2000,
  overtimeMultiplier: 1.5,
  cleaningIncluded: true,
};

const HOST_RULES_MD = `- Leave the space as found; tidy up and remove equipment/rentals by end time
- No nails, screws, staples, tape, or gum-backed materials
- Furniture moves require advance notice
- No smoking, glitter/confetti, open flames, frying, or high-smoke cooking
- Damages billed to the card on file`;

const PARKING_DESC =
  "$25/day reserved garage parking under the building. Provide guest emails/mobile numbers at least 24 hours ahead.";

/** Removed from the active catalog; kept for restore. See docs/REMOVED_FEATURES.md. */
export function legacyParkingAddon(id: string): AddonPublic {
  return {
    id,
    name: "Parking",
    description: PARKING_DESC,
    priceCents: 2500,
    unit: "per_day",
    leadTimeHours: 24,
    requiresGuestFields: ["emails", "phones"],
  };
}

export const LEGACY_PARKING_ADDON: AddonPublic = legacyParkingAddon(IDS.parkingM1);

type RoomPhoto = SpacePublic["photos"][number];

/** Shared Cue Arts District shots shown after each room's own photo(s). */
const GENERAL_PHOTOS: Omit<RoomPhoto, "sortOrder">[] = [
  {
    url: "/images/rooms/cue-kitchenette.jpg",
    alt: "Cue kitchenette with coffee machine, counter seating and a high-top table",
  },
  {
    url: "/images/rooms/cue-lounge.jpg",
    alt: "Cue lounge sitting area with a sofa, armchairs and coffee tables",
  },
  {
    url: "/images/rooms/cue-common-area.jpg",
    alt: "Open common area at Cue Arts District with lounge seating and the Cue moss wall sign",
  },
];

/** Room photo(s) first, then the shared general shots (see MAX_GALLERY_PHOTOS). */
function roomPhotos(own: Omit<RoomPhoto, "sortOrder">[]): RoomPhoto[] {
  return [...own, ...GENERAL_PHOTOS].map((p, i) => ({ ...p, sortOrder: i }));
}

const ROOM_OWN_PHOTOS: Record<string, Omit<RoomPhoto, "sortOrder">[]> = {
  M1: [
    {
      url: "/images/rooms/m1-meeting-room.jpg",
      alt: "M1 Meeting Room seen through its glass door, with a conference table and chairs",
    },
  ],
  M2: [
    {
      url: "/images/rooms/m2-conference-room.jpg",
      alt: "M2 Conference Room behind a glass wall, with a long conference table seating 20",
    },
  ],
  M3: [
    {
      url: "/images/rooms/m3-meeting-room.jpg",
      alt: "M3 Meeting Room with a table for five and a wall-mounted screen on a navy accent wall",
    },
    {
      url: "/images/rooms/m3-meeting-room-screen.jpg",
      alt: "M3 Meeting Room through the glass door, with the TV on the navy wall",
    },
  ],
  M4: [
    {
      url: "/images/rooms/m4-meeting-room.jpg",
      alt: "M4 Meeting Room seen through its glass wall, with a conference table and chairs",
    },
  ],
};

function makeRoom(opts: {
  id: string;
  slug: string;
  shortTitle: string;
  capacity: number;
  seatedCapacity?: number;
  baseHourlyCents: number;
  minHours?: number;
  googleCalendarId: string;
  googleBusyCalendarIds?: string[];
  parkingAddonId: string;
}): SpacePublic {
  return {
    id: opts.id,
    slug: opts.slug,
    title: `${opts.shortTitle} Meeting Room`,
    shortTitle: opts.shortTitle,
    subtitle: `${capacityLabel(opts)} · ${CUE_LOCATION.name}`,
    description: "Meeting room for presentations, team meetings, and workshops.",
    city: CUE_LOCATION.city,
    neighborhood: CUE_LOCATION.neighborhood,
    timezone: "America/Chicago",
    capacity: opts.capacity,
    seatedCapacity: opts.seatedCapacity,
    status: "live",
    pricing: {
      ...ROOM_PRICING,
      baseHourlyCents: opts.baseHourlyCents,
      minHours: opts.minHours ?? DEFAULT_MIN_HOURS,
    },
    bookableHours: SHARED_HOURS,
    photos: roomPhotos(ROOM_OWN_PHOTOS[opts.shortTitle] ?? []),
    amenities: SHARED_AMENITIES,
    // Parking addon removed from the default catalog; see docs/REMOVED_FEATURES.md.
    addons: FEATURES.parkingAddon ? [legacyParkingAddon(opts.parkingAddonId)] : [],
    hostRulesMd: HOST_RULES_MD,
    cancellationPolicy: { name: "Standard", rules: CANCELLATION_RULES },
    host: { name: "Darcy Y." },
    addressPrivate: "REDACTED — reveal after accept",
    hostId: IDS.host,
    cancellationPolicyId: IDS.policy,
    location: CUE_LOCATION,
    locationId: CUE_LOCATION.id,
    googleCalendarId: opts.googleCalendarId,
    googleBusyCalendarIds: opts.googleBusyCalendarIds ?? [],
  };
}

export const CUE_M1: SpacePublic = makeRoom({
  id: IDS.m1,
  slug: "arts-district-m1",
  shortTitle: "M1",
  // "Seats 8 (max 10)" — see migrations/017_seated_capacity.sql.
  capacity: 10,
  seatedCapacity: 8,
  baseHourlyCents: 7000,
  googleCalendarId:
    "c_e88039667398de2f9dd4f5b5c52147b034323e48620c7cb4c278eefcdc0601a6@group.calendar.google.com",
  parkingAddonId: IDS.parkingM1,
});

export const CUE_M2: SpacePublic = makeRoom({
  id: IDS.m2,
  slug: "arts-district-m2",
  shortTitle: "M2",
  capacity: 20,
  baseHourlyCents: 12500,
  googleCalendarId:
    "c_8b3363b1a13418a42df25d270780f453fa4f4e2de9be4b5d85bc3119ea23ff3a@group.calendar.google.com",
  // Busy + write sync use only "SPP - M2 Conference Room"; "M2 - SPP" is ignored.
  parkingAddonId: IDS.parkingM2,
});

export const CUE_M3: SpacePublic = makeRoom({
  id: IDS.m3,
  slug: "arts-district-m3",
  shortTitle: "M3",
  capacity: 5,
  baseHourlyCents: 3500,
  googleCalendarId:
    "c_fa24824eeb56172234a4e332185b1590926da705c57c76d6d99d3a164f696ba6@group.calendar.google.com",
  parkingAddonId: "d0000000-0000-4000-8000-000000000003",
});

export const CUE_M4: SpacePublic = makeRoom({
  id: IDS.m4,
  slug: "arts-district-m4",
  shortTitle: "M4",
  capacity: 10,
  seatedCapacity: 8,
  baseHourlyCents: 7000,
  googleCalendarId:
    "c_44bb9580defceabfbb00be84aee1b13223c607efffc9051673f813a5e03a6152@group.calendar.google.com",
  parkingAddonId: "d0000000-0000-4000-8000-000000000004",
});

/** @deprecated back-compat alias for the former single-room seed (now M1) */
export const CUE_SPACE: SpacePublic = CUE_M1;

export const CUE_SPACES: SpacePublic[] = [CUE_M1, CUE_M2, CUE_M3, CUE_M4];
export const CUE_LOCATIONS: LocationPublic[] = [CUE_LOCATION];

export const HOST_EMAIL_DEFAULT = "host@example.com";
