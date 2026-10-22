import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeBooking, createBookingRequest, createQuoteForSpace } from "../lib/bookings";
import * as stripeLib from "../lib/stripe";
import { setEmailSender } from "../lib/email";
import { CUE_M2, IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";
import { clearMock, setMockBusy } from "../lib/google-calendar";
import {
  firstBookableDate,
  futureStartTimes,
  isStartInPast,
  localDateString,
  wallClockToUtc,
} from "../lib/booking-window";

const M2_CAL = CUE_M2.googleCalendarId!;
const GUEST = { name: "Test Guest", email: "guest@example.com" };

// Wed 2026-10-21 15:18 CT (CDT, UTC-5) — the moment the past-start booking slipped through.
const WED_318PM = new Date("2026-10-21T20:18:00.000Z");
// Selina's Peerspace booking on the M2 calendar: Thu Oct 22 7:30am–5:30pm CT.
const PEERSPACE_THU = { startsAt: "2026-10-22T12:30:00.000Z", endsAt: "2026-10-22T22:30:00.000Z" };
// The request that should have been refused: Thu 9am → Fri 5pm CT, daily 9–5.
const THU_9AM = "2026-10-22T14:00:00.000Z";
const THU_5PM = "2026-10-22T22:00:00.000Z";
const FRI_5PM = "2026-10-23T22:00:00.000Z";

let piStatus: Record<string, string>;
let piAmount: Record<string, number>;
let piSeq: number;

function useRealishStripe() {
  vi.spyOn(stripeLib, "createManualCapturePaymentIntent").mockImplementation(async (opts) => {
    const id = `pi_test_${++piSeq}`;
    piStatus[id] = "requires_payment_method";
    piAmount[id] = opts.amountCents;
    return { paymentIntentId: id, clientSecret: `${id}_secret_abc`, captureMethod: "manual" as const };
  });
  vi.spyOn(stripeLib, "retrievePaymentIntent").mockImplementation(async (id: string) => ({
    id,
    status: piStatus[id] ?? "canceled",
    amountCents: piAmount[id],
    clientSecret: `${id}_secret_abc`,
    mock: false,
  }));
  return vi.spyOn(stripeLib, "cancelPaymentIntent").mockImplementation(async (id: string) => {
    piStatus[id] = "canceled";
    return { id, status: "canceled" } as never;
  });
}

beforeEach(() => {
  resetStore();
  clearMock();
  vi.restoreAllMocks();
  piStatus = {};
  piAmount = {};
  piSeq = 0;
  setEmailSender({ send: async () => undefined } as never);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WED_318PM);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setEmailSender(null);
});

describe("bug 1: busy times block overlapping requests (DB + Google, every day of a multi-day request)", () => {
  it("refuses Thu 9am–Fri 5pm on M2 when the M2 Google calendar has a Thu 7:30–5:30 Peerspace booking", async () => {
    setMockBusy(M2_CAL, [PEERSPACE_THU]);
    const q = await createQuoteForSpace(IDS.m2, new Date(THU_9AM), new Date(THU_5PM), [], new Date(FRI_5PM), 8);
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.error).toBe("slot_unavailable");

    const res = await createBookingRequest({
      spaceId: IDS.m2,
      startsAt: THU_9AM,
      endsAt: THU_5PM,
      endDate: FRI_5PM,
      parkingPasses: 8,
      guest: GUEST,
    });
    expect("booking" in res).toBe(false);
    if (!("booking" in res)) expect(res.error).toBe("slot_unavailable");
  });

  it("a conflict on only the second day of a multi-day request still blocks it", async () => {
    setMockBusy(M2_CAL, [{ startsAt: "2026-10-23T19:00:00.000Z", endsAt: "2026-10-23T20:00:00.000Z" }]);
    const q = await createQuoteForSpace(IDS.m2, new Date(THU_9AM), new Date(THU_5PM), [], new Date(FRI_5PM));
    expect(q.ok).toBe(false);
  });

  it("a conflict only in the overnight gap between days does not block (each day's window is checked)", async () => {
    setMockBusy(M2_CAL, [{ startsAt: "2026-10-23T02:00:00.000Z", endsAt: "2026-10-23T04:00:00.000Z" }]);
    const q = await createQuoteForSpace(IDS.m2, new Date(THU_9AM), new Date(THU_5PM), [], new Date(FRI_5PM));
    expect(q.ok).toBe(true);
  });

  it("a span ending on a later day without endDate is treated as multi-day: both days priced and checked", async () => {
    // Friday-only conflict: before the fix only Thursday's window was checked (and billed).
    setMockBusy(M2_CAL, [{ startsAt: "2026-10-23T19:00:00.000Z", endsAt: "2026-10-23T20:00:00.000Z" }]);
    const blocked = await createQuoteForSpace(IDS.m2, new Date(THU_9AM), new Date(FRI_5PM));
    expect(blocked.ok).toBe(false);

    clearMock();
    const ok = await createQuoteForSpace(IDS.m2, new Date(THU_9AM), new Date(FRI_5PM));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.quote.hours).toBe(16);
  });

  it("an existing requested booking in our DB blocks an overlapping request", async () => {
    vi.spyOn(stripeLib, "createManualCapturePaymentIntent");
    const first = await createBookingRequest({ spaceId: IDS.m2, startsAt: THU_9AM, endsAt: THU_5PM, guest: GUEST });
    if (!("booking" in first)) throw new Error(first.message);
    expect(first.booking.status).toBe("requested"); // demo mode authorizes immediately
    const second = await createQuoteForSpace(
      IDS.m2,
      new Date("2026-10-22T16:00:00.000Z"),
      new Date("2026-10-22T18:00:00.000Z")
    );
    expect(second.ok).toBe(false);
  });

  it("authorize fails closed (keeps the draft, no promotion) when the room calendar can't be read", async () => {
    const cancelSpy = useRealishStripe();
    const res = await createBookingRequest({
      spaceId: IDS.m2,
      startsAt: THU_9AM,
      endsAt: THU_5PM,
      guest: GUEST,
      clientRequestKey: "key-failclosed",
    });
    if (!("booking" in res)) throw new Error(res.message);
    piStatus[res.booking.stripePaymentIntentId!] = "requires_capture";

    vi.stubEnv("GOOGLE_CALENDAR_MODE", "live");
    vi.stubEnv("GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON", "");
    vi.stubEnv("GOOGLE_CALENDAR_SERVICE_ACCOUNT_FILE", "");
    vi.stubEnv("GOOGLE_CALENDAR_REFRESH_TOKEN", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const auth = await authorizeBooking(res.booking.id);
    expect("booking" in auth).toBe(false);
    if (!("booking" in auth)) expect(auth.error).toBe("calendar_unavailable");
    expect(getStore().getBooking(res.booking.id)?.status).toBe("draft");
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it("authorize refuses a draft whose slot was taken on the Google calendar meanwhile", async () => {
    useRealishStripe();
    const res = await createBookingRequest({
      spaceId: IDS.m2,
      startsAt: THU_9AM,
      endsAt: THU_5PM,
      guest: GUEST,
      clientRequestKey: "key-takenlater",
    });
    if (!("booking" in res)) throw new Error(res.message);
    piStatus[res.booking.stripePaymentIntentId!] = "requires_capture";
    setMockBusy(M2_CAL, [PEERSPACE_THU]);
    const auth = await authorizeBooking(res.booking.id);
    expect("booking" in auth).toBe(false);
    if (!("booking" in auth)) expect(auth.error).toBe("slot_unavailable");
  });
});

describe("bug 2: no start times in the past (America/Chicago)", () => {
  it("quote rejects Wed 9:00–1:30 when it's already Wed 3:18pm CT", async () => {
    const q = await createQuoteForSpace(
      IDS.m2,
      new Date("2026-10-21T14:00:00.000Z"),
      new Date("2026-10-21T18:30:00.000Z")
    );
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.error).toBe("start_in_past");
  });

  it("quote rejects a start earlier today and one that's exactly now, accepts a later one today", async () => {
    const earlier = await createQuoteForSpace(IDS.m3, new Date("2026-10-21T20:00:00.000Z"), new Date("2026-10-21T21:00:00.000Z"));
    expect(earlier.ok).toBe(false);
    vi.setSystemTime(new Date("2026-10-21T20:30:00.000Z"));
    const exactlyNow = await createQuoteForSpace(IDS.m3, new Date("2026-10-21T20:30:00.000Z"), new Date("2026-10-21T21:30:00.000Z"));
    expect(exactlyNow.ok).toBe(false);
    const later = await createQuoteForSpace(IDS.m3, new Date("2026-10-21T21:00:00.000Z"), new Date("2026-10-21T22:00:00.000Z"));
    expect(later.ok).toBe(true);
  });

  it("a multi-day request whose first day has already started is rejected", async () => {
    const q = await createQuoteForSpace(
      IDS.m2,
      new Date("2026-10-21T14:00:00.000Z"),
      new Date("2026-10-21T22:00:00.000Z"),
      [],
      new Date("2026-10-23T22:00:00.000Z")
    );
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.error).toBe("start_in_past");
  });

  it("creating a booking (draft) for a past start is rejected and no PaymentIntent is created", async () => {
    const piSpy = vi.spyOn(stripeLib, "createManualCapturePaymentIntent");
    const res = await createBookingRequest({
      spaceId: IDS.m2,
      startsAt: "2026-10-21T14:00:00.000Z",
      endsAt: "2026-10-21T18:30:00.000Z",
      guest: GUEST,
    });
    expect("booking" in res).toBe(false);
    if (!("booking" in res)) expect(res.error).toBe("start_in_past");
    expect(piSpy).not.toHaveBeenCalled();
  });

  it("authorize refuses a draft whose start passed while the checkout sat open, and releases the hold", async () => {
    const cancelSpy = useRealishStripe();
    vi.setSystemTime(new Date("2026-10-21T13:50:00.000Z")); // Wed 8:50am CT
    const res = await createBookingRequest({
      spaceId: IDS.m2,
      startsAt: "2026-10-21T14:00:00.000Z",
      endsAt: "2026-10-21T15:00:00.000Z",
      guest: GUEST,
      clientRequestKey: "key-stalecheckout",
    });
    if (!("booking" in res)) throw new Error(res.message);
    piStatus[res.booking.stripePaymentIntentId!] = "requires_capture";

    vi.setSystemTime(new Date("2026-10-21T14:05:00.000Z")); // 9:05am CT, after the start
    const auth = await authorizeBooking(res.booking.id);
    expect("booking" in auth).toBe(false);
    if (!("booking" in auth)) expect(auth.error).toBe("start_in_past");
    expect(getStore().getBooking(res.booking.id)?.status).not.toBe("requested");
    expect(cancelSpy).toHaveBeenCalledWith(res.booking.stripePaymentIntentId);
  });
});

describe("booking-window helpers (room page pickers)", () => {
  const OPTS = ["08:00", "08:30", "09:00", "15:00", "15:30", "16:00", "17:00"];

  it("today's options drop start times at or before now (CT); future dates keep all; past dates have none", () => {
    expect(futureStartTimes(OPTS, "2026-10-21", WED_318PM)).toEqual(["15:30", "16:00", "17:00"]);
    expect(futureStartTimes(OPTS, "2026-10-22", WED_318PM)).toEqual(OPTS);
    expect(futureStartTimes(OPTS, "2026-10-20", WED_318PM)).toEqual([]);
  });

  it("uses Chicago's date, not UTC's (11pm CT is already tomorrow in UTC)", () => {
    const wed11pm = new Date("2026-10-22T04:00:00.000Z");
    expect(localDateString(wed11pm)).toBe("2026-10-21");
    expect(futureStartTimes(OPTS, "2026-10-21", wed11pm)).toEqual([]);
  });

  it("first bookable date skips a finished today and weekends", () => {
    expect(firstBookableDate(OPTS, WED_318PM)).toBe("2026-10-21");
    expect(firstBookableDate(OPTS, new Date("2026-10-21T22:30:00.000Z"))).toBe("2026-10-22"); // Wed 5:30pm
    expect(firstBookableDate(OPTS, new Date("2026-10-23T23:00:00.000Z"))).toBe("2026-10-26"); // Fri 6pm → Mon
  });

  it("wall-clock times are converted as America/Chicago regardless of the browser's zone, across DST", () => {
    expect(wallClockToUtc("2026-10-22", "09:00").toISOString()).toBe("2026-10-22T14:00:00.000Z"); // CDT
    expect(wallClockToUtc("2026-11-02", "09:00").toISOString()).toBe("2026-11-02T15:00:00.000Z"); // CST
  });

  it("isStartInPast treats 'exactly now' as past", () => {
    expect(isStartInPast(WED_318PM, WED_318PM)).toBe(true);
    expect(isStartInPast(new Date(WED_318PM.getTime() + 60_000), WED_318PM)).toBe(false);
  });
});
