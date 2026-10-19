import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("google-auth-library", () => {
  class FakeAuthClient {
    setCredentials() {
      /* no-op */
    }
    async getAccessToken() {
      return { token: "mock-access-token" };
    }
  }
  return { JWT: FakeAuthClient, OAuth2Client: FakeAuthClient };
});

import {
  setMockBusy,
  clearMock,
  getMockEvents,
} from "../lib/google-calendar";
import { CUE_M1, CUE_M2, IDS } from "../lib/seed";
import {
  createQuoteForSpace,
  createBookingRequest,
  acceptBooking,
  cancelBooking,
} from "../lib/bookings";
import { getStore, resetStore } from "../lib/store";

// Monday 2027-01-04, 9:00-12:00 America/Chicago (CST, UTC-6 in January) = 15:00-18:00 UTC.
const WINDOW_START = new Date("2027-01-04T15:00:00.000Z");
const WINDOW_END = new Date("2027-01-04T18:00:00.000Z");
// 10:00-11:00 local = 16:00-17:00 UTC.
const BUSY_10_11_UTC = {
  startsAt: "2027-01-04T16:00:00.000Z",
  endsAt: "2027-01-04T17:00:00.000Z",
};

const originalMode = process.env.GOOGLE_CALENDAR_MODE;
const originalEnv = {
  clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  refreshToken: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
};

beforeEach(() => {
  process.env.GOOGLE_CALENDAR_MODE = "mock";
  resetStore();
  clearMock();
});

afterEach(() => {
  process.env.GOOGLE_CALENDAR_MODE = originalMode;
  process.env.GOOGLE_CALENDAR_CLIENT_ID = originalEnv.clientId;
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = originalEnv.clientSecret;
  process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = originalEnv.refreshToken;
  clearMock();
});

describe("Google Calendar mock busy", () => {
  it("blocks a quote that overlaps M1's own calendar, leaves M2 unaffected", async () => {
    setMockBusy(CUE_M1.googleCalendarId!, [BUSY_10_11_UTC]);

    const m1 = await createQuoteForSpace(IDS.m1, WINDOW_START, WINDOW_END);
    expect(m1.ok).toBe(false);
    if (!m1.ok) {
      expect(m1.status).toBe(409);
      expect(m1.error).toBe("slot_unavailable");
    }

    const m2 = await createQuoteForSpace(IDS.m2, WINDOW_START, WINDOW_END);
    expect(m2.ok).toBe(true);
  });

  it("M2 checks only 'SPP - M2 Conference Room'; the old 'M2 - SPP' calendar is ignored", async () => {
    expect(CUE_M2.googleBusyCalendarIds ?? []).toEqual([]);

    setMockBusy(
      "c_4a620221db3b792706f2006543986fa6ba4de1b596798b2977daef22623147c9@group.calendar.google.com",
      [BUSY_10_11_UTC]
    );
    const ignored = await createQuoteForSpace(IDS.m2, WINDOW_START, WINDOW_END);
    expect(ignored.ok).toBe(true);

    setMockBusy(CUE_M2.googleCalendarId!, [BUSY_10_11_UTC]);
    const m2 = await createQuoteForSpace(IDS.m2, WINDOW_START, WINDOW_END);
    expect(m2.ok).toBe(false);
    if (!m2.ok) {
      expect(m2.status).toBe(409);
      expect(m2.error).toBe("slot_unavailable");
    }
  });
});

describe("Google Calendar event lifecycle", () => {
  it("accept creates a mock event on the room's calendar and stores google_event_id; cancel deletes it", async () => {
    const created = await createBookingRequest({
      spaceId: IDS.m1,
      startsAt: WINDOW_START.toISOString(),
      endsAt: new Date(WINDOW_START.getTime() + 60 * 60 * 1000).toISOString(),
      guest: { name: "Ada", email: "ada-cal@example.com" },
    });
    if (!("booking" in created)) throw new Error("expected a booking");
    const bookingId = created.booking.id;

    const accepted = await acceptBooking(bookingId);
    if (!("booking" in accepted)) throw new Error("expected acceptance");
    expect(accepted.calendarSyncWarning).toBeUndefined();

    const events = getMockEvents();
    expect(events.length).toBe(1);
    expect(events[0].calendarId).toBe(CUE_M1.googleCalendarId);
    expect(events[0].summary).toContain("Ada");
    expect(events[0].extendedProperties.private.cueBookingId).toBe(bookingId);

    const stored = getStore().getBooking(bookingId);
    expect(stored?.googleEventId).toBe(events[0].id);

    const cancelled = await cancelBooking(bookingId);
    expect("booking" in cancelled).toBe(true);
    expect(getMockEvents().length).toBe(0);
  });
});

describe("Google Calendar live mode — fail closed", () => {
  it("fails closed (409 calendar_unavailable) when the freebusy API call errors", async () => {
    process.env.GOOGLE_CALENDAR_MODE = "live";
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "test-client";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = "test-refresh";

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("{}", { status: 500 }));

    try {
      const result = await createQuoteForSpace(IDS.m1, WINDOW_START, WINDOW_END);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.error).toBe("calendar_unavailable");
        expect(result.message).toMatch(/hello@thecue\.work/);
      }
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
