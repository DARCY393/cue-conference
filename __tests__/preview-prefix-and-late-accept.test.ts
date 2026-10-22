import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptBooking, createBookingRequest, declineBooking } from "../lib/bookings";
import * as stripeLib from "../lib/stripe";
import {
  applySubjectPrefix,
  emailSubjectPrefix,
  getEmailSender,
  PREVIEW_SUBJECT_PREFIX,
  setEmailSender,
} from "../lib/email";
import { IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";
import { isAcceptable } from "../lib/booking-window";

// Wed 2026-10-21 8:50am CT; the request is for 9:00–10:00am CT that day.
const BEFORE = new Date("2026-10-21T13:50:00.000Z");
const SLOT = { startsAt: "2026-10-21T14:00:00.000Z", endsAt: "2026-10-21T15:00:00.000Z" };
const GUEST = { name: "Test Guest", email: "guest@example.com" };

let sent: { to: string; subject: string }[];

beforeEach(() => {
  resetStore();
  clearMock();
  vi.restoreAllMocks();
  sent = [];
  setEmailSender({
    send: async (m: { to: string; subject: string }) => {
      sent.push({ to: m.to, subject: m.subject });
    },
  } as never);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BEFORE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setEmailSender(null);
});

async function requestAt9() {
  const res = await createBookingRequest({ spaceId: IDS.m2, ...SLOT, guest: GUEST });
  if (!("booking" in res)) throw new Error(res.message);
  expect(res.booking.status).toBe("requested");
  return res.booking;
}

describe("[PREVIEW] subject prefix", () => {
  it("is off by default and for any value other than preview (live unchanged)", () => {
    vi.stubEnv("CUE_APP_ENV", "");
    expect(emailSubjectPrefix()).toBe("");
    vi.stubEnv("CUE_APP_ENV", "production");
    expect(emailSubjectPrefix()).toBe("");
    expect(applySubjectPrefix("Booking confirmed — M2")).toBe("Booking confirmed — M2");
  });

  it("CUE_APP_ENV=preview prefixes every outgoing subject once", async () => {
    vi.stubEnv("CUE_APP_ENV", "preview");
    expect(emailSubjectPrefix()).toBe(PREVIEW_SUBJECT_PREFIX);
    await getEmailSender().send({ to: "a@example.com", subject: "Hello", text: "x" } as never);
    await getEmailSender().send({ to: "a@example.com", subject: "[PREVIEW] Already", text: "x" } as never);
    expect(sent.map((m) => m.subject)).toEqual(["[PREVIEW] Hello", "[PREVIEW] Already"]);
  });

  it("booking emails (guest + host alert) carry the prefix on the preview, and not otherwise", async () => {
    vi.stubEnv("CUE_APP_ENV", "preview");
    await requestAt9();
    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const m of sent) expect(m.subject.startsWith("[PREVIEW] ")).toBe(true);

    resetStore();
    sent = [];
    vi.stubEnv("CUE_APP_ENV", "");
    await requestAt9();
    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const m of sent) expect(m.subject.startsWith("[PREVIEW]")).toBe(false);
  });
});

describe("staff accept refuses requests whose start has passed", () => {
  it("accept before the start works", async () => {
    const b = await requestAt9();
    const r = await acceptBooking(b.id);
    expect("booking" in r && r.booking?.status).toBe("accepted");
  });

  it("accept at or after the start is refused without capturing; decline still releases the hold", async () => {
    const captureSpy = vi.spyOn(stripeLib, "capturePaymentIntent");
    const cancelSpy = vi.spyOn(stripeLib, "cancelPaymentIntent");
    const b = await requestAt9();

    vi.setSystemTime(new Date(SLOT.startsAt)); // exactly 9:00am CT
    const atStart = await acceptBooking(b.id);
    expect("error" in atStart && atStart.error).toBe("start_in_past");
    expect("message" in atStart && atStart.message).toMatch(/already passed.*Decline/);

    vi.setSystemTime(new Date("2026-10-21T20:20:00.000Z")); // 3:20pm CT, the Oct 21 case
    const late = await acceptBooking(b.id);
    expect("error" in late && late.status).toBe(409);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(getStore().getBooking(b.id)?.status).toBe("requested");

    const d = await declineBooking(b.id);
    expect("error" in d).toBe(false);
    expect(getStore().getBooking(b.id)?.status).toBe("declined");
    expect(cancelSpy).toHaveBeenCalledWith(b.stripePaymentIntentId);
  });

  it("isAcceptable (staff UI) hides Accept once the start passes", () => {
    const b = { status: "requested", startsAt: SLOT.startsAt };
    expect(isAcceptable(b, BEFORE)).toBe(true);
    expect(isAcceptable(b, new Date(SLOT.startsAt))).toBe(false);
    expect(isAcceptable({ ...b, status: "accepted" }, BEFORE)).toBe(false);
  });
});
