import type { FlexibleRules, SpacePublic } from "./types";
import { FLEXIBLE_DEFAULT } from "./refund";

export const IDS = {
  policy: "a0000000-0000-4000-8000-000000000001",
  host: "b0000000-0000-4000-8000-000000000001",
  space: "c0000000-0000-4000-8000-000000000001",
  parking: "d0000000-0000-4000-8000-000000000001",
} as const;

export const FLEXIBLE_RULES: FlexibleRules = { ...FLEXIBLE_DEFAULT };

export const CUE_SPACE: SpacePublic = {
  id: IDS.space,
  slug: "cue-dallas",
  title: "Cue",
  subtitle: "Bright 10 Person Conference Room in Dallas",
  description:
    "Private conference room for presentations, team meetings, workshops, and brainstorming.",
  city: "Dallas",
  neighborhood: "Dallas Downtown Historic District",
  timezone: "America/Chicago",
  capacity: 10,
  status: "live",
  pricing: {
    currency: "usd",
    baseHourlyCents: 7000,
    minHours: 1,
    longBookingThresholdHours: 8,
    longBookingDiscountBps: 2000,
    overtimeMultiplier: 1.5,
    cleaningIncluded: true,
  },
  bookableHours: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 7 * 60,
    endMinute: 18 * 60,
  })),
  photos: [
    {
      url: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200",
      alt: "Bright conference room",
      sortOrder: 0,
    },
  ],
  amenities: [
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
  ],
  addons: [
    {
      id: IDS.parking,
      name: "Parking",
      description:
        "$25/day reserved garage parking under the building. Provide guest emails/mobile numbers at least 24 hours ahead.",
      priceCents: 2500,
      unit: "per_day",
      leadTimeHours: 24,
      requiresGuestFields: ["emails", "phones"],
    },
  ],
  hostRulesMd: `- Leave the space as found; tidy up and remove equipment/rentals by end time
- No nails, screws, staples, tape, or gum-backed materials
- Furniture moves require advance notice
- No smoking, glitter/confetti, open flames, frying, or high-smoke cooking
- Overtime billed in 30-minute increments at 1.5× hourly rate
- Damages billed to the card on file`,
  cancellationPolicy: { name: "Flexible", rules: FLEXIBLE_RULES },
  host: { name: "Darcy Y." },
  addressPrivate: "REDACTED — reveal after accept",
  hostId: IDS.host,
  cancellationPolicyId: IDS.policy,
};

export const HOST_EMAIL_DEFAULT = "host@example.com";
