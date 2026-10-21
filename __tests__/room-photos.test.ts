import { existsSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { CUE_M1, CUE_M2, CUE_M3, CUE_M4 } from "@/lib/seed";
import { MAX_GALLERY_PHOTOS, toPublicSpaceJson } from "@/lib/space-public";

const GENERAL = [
  "/images/rooms/cue-kitchenette.jpg",
  "/images/rooms/cue-lounge.jpg",
  "/images/rooms/cue-common-area.jpg",
];

describe("room photos", () => {
  it.each([
    [CUE_M1, ["/images/rooms/m1-meeting-room.jpg"]],
    [CUE_M2, ["/images/rooms/m2-conference-room.jpg"]],
    [CUE_M3, ["/images/rooms/m3-meeting-room.jpg", "/images/rooms/m3-meeting-room-screen.jpg"]],
    [CUE_M4, ["/images/rooms/m4-meeting-room.jpg"]],
  ])("%s leads with its own photo(s), then the general shots", (space, own) => {
    const pub = toPublicSpaceJson(space);
    expect(pub.photos.map((p) => p.url)).toEqual([...own, ...GENERAL]);
    expect(pub.photos.map((p) => p.sortOrder)).toEqual(pub.photos.map((_, i) => i));
    expect(pub.photos.length).toBeLessThanOrEqual(MAX_GALLERY_PHOTOS);
    for (const p of pub.photos) {
      expect(p.alt && p.alt.length).toBeGreaterThan(10);
      const file = join(process.cwd(), "public", p.url);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeLessThan(400 * 1024);
    }
  });
});
