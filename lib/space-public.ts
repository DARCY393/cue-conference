import type { SpacePublic } from "./types";

/** Strip host/internal-only fields before a space is serialized to a guest/public API response. */
export function toPublicSpaceJson(space: SpacePublic): SpacePublic {
  const copy = structuredClone(space);
  delete copy.addressPrivate;
  delete copy.hostId;
  delete copy.cancellationPolicyId;
  delete copy.googleCalendarId;
  delete copy.googleBusyCalendarIds;
  // Cap the gallery at 3 photos regardless of source (DB rows beyond sort_order 2 are ignored).
  copy.photos = copy.photos.slice(0, 3);
  return copy;
}
