import type { FlexibleRules, LocationPublic, SpacePublic } from "./types";
import { FLEXIBLE_DEFAULT } from "./refund";

export const IDS = {
  policy: "a0000000-0000-4000-8000-000000000001",
  host: "b0000000-0000-4000-8000-000000000001",
  space: "c0000000-0000-4000-8000-000000000001",
  space2: "c0000000-0000-4000-8000-000000000002",
  parking: "d0000000-0000-4000-8000-000000000001",
  parking2: "d0000000-0000-4000-8000-000000000002",
  location: "e0000000-0000-4000-8000-000000000001",
} as const;

export const FLEXIBLE_RULES: FlexibleRules = { ...FLEXIBLE_DEFAULT };

export const CUE_LOCATION: LocationPublic = {
  id: IDS.location,
  slug: "downtown-arts-district",
  name: "Arts District / Downtown",
  city: "Dallas",
  neighborhood: "Arts District",
  addressPublic: "750 N. St. Paul Street, Dallas, TX 75201",
};

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

const SHARED_PRICING = {
  currency: "usd",
  baseHourlyCents: 7000,
  minHours: 1,
  longBookingThresholdHours: 8,
  longBookingDiscountBps: 2000,
  overtimeMultiplier: 1.5,
  cleaningIncluded: true,
};

const HOST_RULES_MD = `- Leave the space as found; tidy up and remove equipment/rentals by end time
- No nails, screws, staples, tape, or gum-backed materials
- Furniture moves require advance notice
- No smoking, glitter/confetti, open flames, frying, or high-smoke cooking
- Overtime billed in 30-minute increments at 1.5× hourly rate
- Damages billed to the card on file`;

const PARKING_DESC =
  "$25/day reserved garage parking under the building. Provide guest emails/mobile numbers at least 24 hours ahead.";

export const CUE_SPACE: SpacePublic = {
  id: IDS.space,
  slug: "cue-dallas",
  title: "Conference Room",
  subtitle: "10 person · Arts District / Downtown",
  description:
    "Private conference room for presentations, team meetings, workshops, and brainstorming.",
  city: "Dallas",
  neighborhood: "Arts District",
  timezone: "America/Chicago",
  capacity: 10,
  status: "live",
  pricing: { ...SHARED_PRICING },
  bookableHours: SHARED_HOURS,
  photos: [
    {
      url: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200",
      alt: "Bright conference room",
      sortOrder: 0,
    },
  ],
  amenities: SHARED_AMENITIES,
  addons: [
    {
      id: IDS.parking,
      name: "Parking",
      description: PARKING_DESC,
      priceCents: 2500,
      unit: "per_day",
      leadTimeHours: 24,
      requiresGuestFields: ["emails", "phones"],
    },
  ],
  hostRulesMd: HOST_RULES_MD,
  cancellationPolicy: { name: "Flexible", rules: FLEXIBLE_RULES },
  host: { name: "Darcy Y." },
  addressPrivate: "REDACTED — reveal after accept",
  hostId: IDS.host,
  cancellationPolicyId: IDS.policy,
  location: CUE_LOCATION,
};

/** Placeholder — confirm capacity, title, and rates with client. */
export const CUE_BOARDROOM: SpacePublic = {
  id: IDS.space2,
  slug: "cue-downtown-boardroom",
  title: "Boardroom",
  subtitle: "8–12 person conference room · Arts District / Downtown",
  description:
    "Private boardroom for presentations, team meetings, workshops, and brainstorming. Capacity and rates are placeholders pending client confirmation.",
  city: "Dallas",
  neighborhood: "Arts District",
  timezone: "America/Chicago",
  capacity: 10,
  status: "live",
  pricing: { ...SHARED_PRICING },
  bookableHours: SHARED_HOURS,
  photos: [
    {
      url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1200",
      alt: "Boardroom meeting table",
      sortOrder: 0,
    },
  ],
  amenities: SHARED_AMENITIES,
  addons: [
    {
      id: IDS.parking2,
      name: "Parking",
      description: PARKING_DESC,
      priceCents: 2500,
      unit: "per_day",
      leadTimeHours: 24,
      requiresGuestFields: ["emails", "phones"],
    },
  ],
  hostRulesMd: HOST_RULES_MD,
  cancellationPolicy: { name: "Flexible", rules: FLEXIBLE_RULES },
  host: { name: "Darcy Y." },
  addressPrivate: "REDACTED — reveal after accept",
  hostId: IDS.host,
  cancellationPolicyId: IDS.policy,
  location: CUE_LOCATION,
};

export const CUE_SPACES: SpacePublic[] = [CUE_SPACE, CUE_BOARDROOM];
export const CUE_LOCATIONS: LocationPublic[] = [CUE_LOCATION];

export const HOST_EMAIL_DEFAULT = "host@example.com";
