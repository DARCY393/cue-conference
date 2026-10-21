import type { SpacePublic } from "./types";

/** Max photos per room gallery: room shot(s) + shared Cue general shots. */
export const MAX_GALLERY_PHOTOS = 6;

/** Strip host/internal-only fields before a space is serialized to a guest/public API response. */
export function toPublicSpaceJson(space: SpacePublic): SpacePublic {
  const copy = structuredClone(space);
  delete copy.addressPrivate;
  delete copy.hostId;
  delete copy.cancellationPolicyId;
  delete copy.googleCalendarId;
  delete copy.googleBusyCalendarIds;
  // Cap the gallery regardless of source (DB rows beyond the cap are ignored).
  copy.photos = copy.photos.slice(0, MAX_GALLERY_PHOTOS);
  return copy;
}
