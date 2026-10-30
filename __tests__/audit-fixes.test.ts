import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queries: { text: string; params?: unknown[] }[] = [];
let dbMode = false;
vi.mock("../lib/db", () => ({
  hasDatabase: () => dbMode,
  query: vi.fn(async (text: string, params?: unknown[]) => {
    queries.push({ text, params });
    return { rows: [], rowCount: 0 };
  }),
}));
vi.mock("../lib/store", async (orig) => {
  const real = await orig<typeof import("../lib/store")>();
  return { ...real, isDemoMode: () => (dbMode ? false : real.isDemoMode()) };
});

import { maskRecipient, recordDelivery } from "../lib/delivery-log";
import { getEmailSender, setEmailSender } from "../lib/email";
import { sendHostSms, setSmsSender } from "../lib/sms";
import { acceptBooking, completeFinishedBookings, createBookingRequest, getBookingById, latestChargeId } from "../lib/bookings";
import * as stripeLib from "../lib/stripe";
import { IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";

beforeEach(() => {
  queries.length = 0;
  dbMode = false;
  resetStore();
});
afterEach(() => {
  setEmailSender(null);
  setSmsSender(null);
  delete process.env.HOST_ALERT_SMS_TO;
  vi.restoreAllMocks();
});

describe("delivery log", () => {
  it("masks phones to last 4, keeps emails", () => {
    expect(maskRecipient("sms", "+12145551234")).toBe("***1234");
    expect(maskRecipient("email", "a@b.co")).toBe("a@b.co");
  });

  it("writes a row and a console line for an email send, with message id", async () => {
    dbMode = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    setEmailSender({ send: async () => ({ status: "sent", messageId: "<m1@x>" }) });
    await getEmailSender().send({ to: "g@x.com", template: "booking_accepted", subject: "s", bookingId: "11111111-1111-1111-1111-111111111111" });
    const ins = queries.find((q) => q.text.includes("INSERT INTO message_logs"))!;
    expect(ins.params).toEqual(["11111111-1111-1111-1111-111111111111", "email", "booking_accepted", "g@x.com", "<m1@x>", "sent", null]);
    expect(log.mock.calls.some((c) => String(c[0]).startsWith("[delivery] email booking_accepted sent"))).toBe(true);
  });

  it("records a failed email when the sender throws, without throwing", async () => {
    dbMode = true;
    vi.spyOn(console, "log").mockImplementation(() => {});
    setEmailSender({ send: async () => { throw new Error("smtp down"); } });
    const r = await getEmailSender().send({ to: "g@x.com", template: "t", subject: "s" });
    expect(r).toMatchObject({ status: "failed" });
    expect(queries[0].params?.[5]).toBe("failed");
    expect(queries[0].params?.[6]).toBe("smtp down");
  });

  it("logs sms with masked number and Twilio SID; never the full number", async () => {
    dbMode = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.HOST_ALERT_SMS_TO = "+12145551234";
    setSmsSender({ send: async () => "SM123" });
    await sendHostSms("hi", "new_request", "22222222-2222-2222-2222-222222222222");
    const ins = queries.find((q) => q.text.includes("INSERT INTO message_logs"))!;
    expect(ins.params).toEqual(["22222222-2222-2222-2222-222222222222", "sms", "new_request", "***1234", "SM123", "sent", null]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("2145551234");
  });

  it("records skipped sms when no recipient is configured", async () => {
    dbMode = true;
    vi.spyOn(console, "log").mockImplementation(() => {});
    setSmsSender({ send: async () => "SM1" });
    await sendHostSms("hi", "cancelled");
    expect(queries[0].params?.[5]).toBe("skipped");
  });

  it("never throws when the DB insert fails", async () => {
    dbMode = true;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await import("../lib/db");
    (db.query as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db gone"));
    await expect(recordDelivery({ channel: "email", kind: "k", recipient: "a@b", status: "sent" })).resolves.toBeUndefined();
  });
});

describe("completed status", () => {
  it("marks accepted bookings past their end completed, idempotently, leaving others", async () => {
    const store = getStore();
    const mk = async (startsAt: string, endsAt: string) => {
      const r = await createBookingRequest({ spaceId: IDS.m3, startsAt, endsAt, guest: { name: "S", email: "s@x.com" }, clientRequestKey: `k-${startsAt}` });
      if (!("booking" in r)) throw new Error(r.message);
      return r.booking.id;
    };
    setEmailSender({ send: async () => undefined });
    const past = await mk("2027-01-05T15:00:00.000Z", "2027-01-05T18:00:00.000Z");
    const future = await mk("2027-01-07T15:00:00.000Z", "2027-01-07T18:00:00.000Z");
    const requested = await mk("2027-01-04T15:00:00.000Z", "2027-01-04T16:00:00.000Z");
    store.updateBooking(past, { status: "accepted" });
    store.updateBooking(future, { status: "accepted" });
    const now = new Date("2027-01-06T00:00:00.000Z");
    const capture = vi.spyOn(stripeLib, "capturePaymentIntent");
    const r1 = await completeFinishedBookings(now);
    expect(r1.completedIds).toEqual([past]);
    expect((await getBookingById(past))!.status).toBe("completed");
    expect((await getBookingById(past))!.completedAt).toBe(now.toISOString());
    expect((await getBookingById(future))!.status).toBe("accepted");
    expect((await getBookingById(requested))!.status).toBe("requested");
    expect((await completeFinishedBookings(now)).completedIds).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("issues an idempotent SQL update in DB mode", async () => {
    dbMode = true;
    await completeFinishedBookings(new Date("2026-10-30T19:00:00Z"));
    expect(queries[0].text).toMatch(/SET status = 'completed', completed_at = COALESCE\(completed_at/);
    expect(queries[0].text).toMatch(/WHERE status IN \('accepted','in_progress'\) AND ends_at <= \$1/);
  });
});

describe("charge id", () => {
  it("reads latest_charge as string or object", () => {
    expect(latestChargeId({ latest_charge: "ch_1" })).toBe("ch_1");
    expect(latestChargeId({ latest_charge: { id: "ch_2" } })).toBe("ch_2");
    expect(latestChargeId({})).toBeUndefined();
  });

  it("saves the captured PaymentIntent's latest_charge on accept", async () => {
    setEmailSender({ send: async () => undefined });
    const r = await createBookingRequest({ spaceId: IDS.m3, startsAt: "2030-01-08T15:00:00.000Z", endsAt: "2030-01-08T16:00:00.000Z", guest: { name: "S", email: "s@x.com" }, clientRequestKey: "k-charge" });
    if (!("booking" in r)) throw new Error(r.message);
    getStore().updateBooking(r.booking.id, { stripePaymentIntentId: "pi_test_1" });
    vi.spyOn(stripeLib, "capturePaymentIntent").mockResolvedValue({ id: "pi_test_1", status: "succeeded", latest_charge: "ch_test_9" } as never);
    const a = await acceptBooking(r.booking.id);
    expect("booking" in a && a.booking?.stripeChargeId).toBe("ch_test_9");
  });
});
