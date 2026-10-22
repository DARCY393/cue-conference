import { beforeEach, vi } from "vitest";

/**
 * Bookings may not start in the past, and most fixtures use fixed dates in early 2027.
 * Pin "now" (Date only; real timers keep running) to Tue 2026-12-01 so the suite doesn't
 * start failing once those dates pass. Tests that freeze their own clock override this.
 */
export const SUITE_NOW = new Date("2026-12-01T18:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUITE_NOW);
});
