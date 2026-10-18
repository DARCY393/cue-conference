import {
  Accessibility,
  Armchair,
  Building2,
  Coffee,
  type LucideIcon,
  Monitor,
  PhoneCall,
  Presentation,
  Printer,
  Projector,
  ScreenShare,
  Table2,
  Tv,
  Utensils,
  Wifi,
} from "lucide-react";

const AMENITY_ICONS: Record<string, LucideIcon> = {
  wifi: Wifi,
  tables: Table2,
  chairs: Armchair,
  screen: ScreenShare,
  whiteboard: Presentation,
  monitor: Monitor,
  conference_phone: PhoneCall,
  apple_tv: Tv,
  coffee: Coffee,
  projector: Projector,
  printer: Printer,
  restrooms: Building2,
  kitchen: Utensils,
  wheelchair_accessible: Accessibility,
};

export function amenityIcon(key: string): LucideIcon {
  return AMENITY_ICONS[key] ?? Building2;
}

export function AmenityTile({ amenityKey, label }: { amenityKey: string; label: string }) {
  const Icon = amenityIcon(amenityKey);
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-tile bg-cue-copper-050 text-cue-copper-700">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <span className="text-sm font-medium text-cue-ink">{label}</span>
    </div>
  );
}
