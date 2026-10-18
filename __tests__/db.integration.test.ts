import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

/**
 * Exercises the real Postgres path (DB mode) instead of the in-memory demo store.
 * Skipped entirely unless TEST_DATABASE_URL is set — vitest.config.ts forces
 * DATABASE_URL="" globally for the demo-mode suite, so this file overrides
 * process.env.DATABASE_URL itself (via dynamic import, after the override) rather
 * than relying on the shared config.
 *
 * Assumes migrations 001-010 are already applied to TEST_DATABASE_URL.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("DB-mode integration (requires TEST_DATABASE_URL)", () => {
  let query: typeof import("../lib/db").query;
  let getSpaceById: typeof import("../lib/space-service").getSpaceById;
  let createQuoteForSpace: typeof import("../lib/bookings").createQuoteForSpace;
  let createBookingRequest: typeof import("../lib/bookings").createBookingRequest;
  let acceptBooking: typeof import("../lib/bookings").acceptBooking;
  let declineBooking: typeof import("../lib/bookings").declineBooking;
  let cancelBooking: typeof import("../lib/bookings").cancelBooking;
  let setMockBusy: typeof import("../lib/google-calendar").setMockBusy;
  let clearMock: typeof import("../lib/google-calendar").clearMock;
  let getMockEvents: typeof import("../lib/google-calendar").getMockEvents;
  let IDS: typeof import("../lib/seed").IDS;

  const createdBookingIds: string[] = [];

  // Wednesday 2030-05-08, 9:00 America/Chicago (CDT, UTC-5 in May) = 14:00 UTC.
  const windowIso = (hours: number, offsetHours = 0) => {
    const start = new Date(
      Date.UTC(2030, 4, 8, 14 + offsetHours, 0, 0)
    );
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    return { startsAt: start, endsAt: end };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.GOOGLE_CALENDAR_MODE = "mock";

    ({ query } = await import("../lib/db"));
    ({ getSpaceById } = await import("../lib/space-service"));
    ({ createQuoteForSpace, createBookingRequest, acceptBooking, declineBooking, cancelBooking } =
      await import("../lib/bookings"));
    ({ setMockBusy, clearMock, getMockEvents } = await import("../lib/google-calendar"));
    ({ IDS } = await import("../lib/seed"));
  });

  afterEach(() => {
    clearMock();
  });

  afterAll(async () => {
    for (const id of createdBookingIds) {
      await query("DELETE FROM bookings WHERE id = $1", [id]);
    }
  });

  it("has the 4 Arts District rooms with the expected rates and 1h minimum", async () => {
    const { rows } = await query<{
      slug: string;
      base_hourly_cents: number;
      min_hours: string;
    }>(
      `SELECT slug, base_hourly_cents, min_hours FROM spaces
       WHERE slug IN ('arts-district-m1','arts-district-m2','arts-district-m3','arts-district-m4')`
    );
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    expect(rows.length).toBe(4);
    expect(Number(bySlug.get("arts-district-m1")?.base_hourly_cents)).toBe(7000);
    expect(Number(bySlug.get("arts-district-m2")?.base_hourly_cents)).toBe(12500);
    expect(Number(bySlug.get("arts-district-m3")?.base_hourly_cents)).toBe(3500);
    expect(Number(bySlug.get("arts-district-m4")?.base_hourly_cents)).toBe(7000);
    for (const row of rows) {
      expect(Number(row.min_hours)).toBe(1);
    }
  });

  it("quotes 2h on M2 as $250.00 with an 'M2 · 2h × $125.00' line item", async () => {
    const { startsAt, endsAt } = windowIso(2);
    const result = await createQuoteForSpace(IDS.m2, startsAt, endsAt);
    if (!result.ok) throw new Error(`expected ok quote, got ${result.error}: ${result.message}`);
    expect(result.quote.totalCents).toBe(25000);
    expect(result.quote.lineItems[0].label).toBe("M2 · 2h × $125.00");
  });

  it("a Google mock busy interval on M1's calendar blocks an overlapping quote", async () => {
    const m1 = await getSpaceById(IDS.m1);
    if (!m1?.googleCalendarId) throw new Error("expected M1 to have a googleCalendarId in DB mode");
    const { startsAt, endsAt } = windowIso(1);
    setMockBusy(m1.googleCalendarId, [
      { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    ]);

    const blocked = await createQuoteForSpace(IDS.m1, startsAt, endsAt);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(409);
  });

  it("createBookingRequest stores a PaymentIntent id; acceptBooking stores google_event_id and creates a mock calendar event; cancelling it deletes that event", async () => {
    const { startsAt, endsAt } = windowIso(1, 2); // 11:00-12:00 CDT, clear of the busy-interval test above
    const created = await createBookingRequest({
      spaceId: IDS.m1,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      guest: { name: "Integration Guest", email: "integration-guest@example.com" },
    });
    if (!("booking" in created)) throw new Error("expected a booking");
    createdBookingIds.push(created.booking.id);
    expect(created.booking.stripePaymentIntentId).toBeTruthy();

    const accepted = await acceptBooking(created.booking.id);
    if (!("booking" in accepted) || !accepted.booking) throw new Error("expected acceptance");
    expect(accepted.calendarSyncWarning).toBeUndefined();
    expect(accepted.booking.googleEventId).toBeTruthy();

    const { rows } = await query<{ google_event_id: string | null }>(
      `SELECT google_event_id FROM bookings WHERE id = $1`,
      [created.booking.id]
    );
    expect(rows[0].google_event_id).toBe(accepted.booking.googleEventId);

    const m1 = await getSpaceById(IDS.m1);
    const events = getMockEvents().filter((e) => e.calendarId === m1?.googleCalendarId);
    expect(events.some((e) => e.id === accepted.booking.googleEventId)).toBe(true);

    const cancelled = await cancelBooking(created.booking.id);
    if (!("booking" in cancelled)) throw new Error("expected cancellation");
    expect(cancelled.booking.status).toBe("cancelled");
    expect(getMockEvents().some((e) => e.id === accepted.booking.googleEventId)).toBe(false);
  });

  it("declineBooking cancels the hold on a separate booking", async () => {
    const { startsAt, endsAt } = windowIso(1, 4); // 13:00-14:00 CDT on M3
    const created = await createBookingRequest({
      spaceId: IDS.m3,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      guest: { name: "Decline Guest", email: "integration-decline@example.com" },
    });
    if (!("booking" in created)) throw new Error("expected a booking");
    createdBookingIds.push(created.booking.id);

    const declined = await declineBooking(created.booking.id);
    if (!("booking" in declined) || !declined.booking) throw new Error("expected decline");
    expect(declined.booking.status).toBe("declined");
  });
});
