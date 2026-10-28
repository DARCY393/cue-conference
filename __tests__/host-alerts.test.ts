import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingRequest, cancelBooking } from "../lib/bookings";
import { setEmailSender, type EmailMessage } from "../lib/email";
import {
  renderHostBookingCancelledEmail,
  renderHostNewRequestEmail,
} from "../lib/email-templates";
import {
  cancelledSms,
  companyFromEmail,
  newRequestSms,
  newRequestSubject,
  shortDateRange,
  shortDeadline,
} from "../lib/host-alerts";
import { dueHostReminder, sendHostDecisionReminders } from "../lib/host-reminders";
import { maskPhone, parseSmsRecipients, sendHostSms, setSmsSender } from "../lib/sms";
import { IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";

// Allison's request: M1 Wed Nov 4 9:00 AM – Thu Nov 5 5:00 PM CT (CST, UTC-6), $976,
// requested Mon Nov 2 3:54 PM CT -> deadline Tue Nov 3 3:54 PM CT.
const ALLISON = {
  roomName: "M1",
  startsAt: "2026-11-04T15:00:00.000Z",
  endsAt: "2026-11-05T23:00:00.000Z",
  totalCents: 97600,
  guestName: "Allison Bastawros",
  guestEmail: "allison@integrity.com",
  hostActionDeadlineAt: "2026-11-03T21:54:00.000Z",
};
const EMAIL_BASE = { ...ALLISON, parkingPasses: 0, parkingCents: 0, bookingId: "b-1" };

const SMS_ENV = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_PHONE_NUMBER",
  "HOST_ALERT_SMS_TO",
  "CUE_APP_ENV",
  "NEXT_PUBLIC_APP_URL",
];

let texts: { to: string; body: string }[] = [];
let sent: EmailMessage[] = [];

beforeEach(() => {
  for (const k of SMS_ENV) delete process.env[k];
  process.env.NEXT_PUBLIC_APP_URL = "https://book.thecue.work";
  texts = [];
  sent = [];
});
afterEach(() => {
  setSmsSender(null);
  setEmailSender(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const k of SMS_ENV) delete process.env[k];
});

describe("host alert formatting", () => {
  it("formats the new-request text like the approved example", () => {
    expect(newRequestSms(ALLISON)).toBe(
      "Cue: NEW request M1 Nov 4–5, Allison Bastawros (Integrity), $976. Accept by Tue 3:54 PM: https://book.thecue.work/host"
    );
  });

  it("formats date ranges, deadlines and companies", () => {
    expect(shortDateRange("2026-10-29T14:00:00.000Z", "2026-10-29T17:00:00.000Z")).toBe("Oct 29 9 AM–12 PM");
    expect(shortDateRange("2026-10-30T14:00:00.000Z", "2026-11-02T22:00:00.000Z")).toBe("Oct 30–Nov 2");
    expect(shortDeadline(ALLISON.hostActionDeadlineAt)).toBe("Tue 3:54 PM");
    expect(companyFromEmail("a@gmail.com")).toBeUndefined();
    expect(companyFromEmail("a@yahoo.com")).toBeUndefined();
    expect(companyFromEmail("a@mail.acme.co.uk")).toBe("Acme");
  });

  it("new-request subject is action-first and the deadline leads the body", () => {
    const r = renderHostNewRequestEmail(EMAIL_BASE);
    expect(r.subject).toBe(
      "🔔 ACTION NEEDED: New booking request — M1 Nov 4–5 — Allison Bastawros (Integrity) ($976)"
    );
    expect(newRequestSubject({ ...ALLISON, guestEmail: "x@gmail.com" })).toBe(
      "🔔 ACTION NEEDED: New booking request — M1 Nov 4–5 — Allison Bastawros ($976)"
    );
    expect(r.text.split("\n")[0]).toMatch(/^ACTION NEEDED: accept or decline by Tue, Nov 3, 2026, 3:54 PM/);
    expect(r.html.indexOf("ACTION NEEDED")).toBeLessThan(r.html.indexOf("A new booking request came in"));
    expect(r.html).toContain("https://book.thecue.work/host");
  });

  it("cancellation subject and text name the outcome", () => {
    const r = renderHostBookingCancelledEmail({
      ...EMAIL_BASE,
      refundCents: 97600,
      action: "refund",
      cancelledBy: "guest",
    });
    expect(r.subject).toBe("Cancelled: M1 Nov 4–5 — Allison Bastawros (Integrity) — refund $976 (by guest)");
    expect(cancelledSms({ ...ALLISON, refundCents: 0, action: "release_hold", cancelledBy: "staff" })).toBe(
      "Cue: CANCELLED by staff — M1 Nov 4–5, Allison Bastawros (Integrity), hold released."
    );
  });
});

describe("sendHostSms", () => {
  it("is a logged no-op when Twilio or recipients are missing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await sendHostSms("hi", "test")).toBe(0);
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "secret-token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";
    expect(await sendHostSms("hi", "test")).toBe(0); // no HOST_ALERT_SMS_TO
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => c[0]).join("\n")).toMatch(/\[sms\] skipped test: HOST_ALERT_SMS_TO not set/);
  });

  it("posts to Twilio with MessagingServiceSid, prefixes preview, masks numbers and never throws", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "secret-token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";
    process.env.TWILIO_PHONE_NUMBER = "+15550001111";
    process.env.HOST_ALERT_SMS_TO = "+12145550123, +12145559876,bogus";
    process.env.CUE_APP_ENV = "preview";
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m) => void logs.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => void logs.push(String(m)));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))
      .mockRejectedValueOnce(new Error("network down"));
    expect(await sendHostSms("hello", "test")).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json");
    const body = new URLSearchParams(String(init!.body));
    expect(body.get("To")).toBe("+12145550123");
    expect(body.get("MessagingServiceSid")).toBe("MG_test");
    expect(body.get("From")).toBeNull();
    expect(body.get("Body")).toBe("[PREVIEW] hello");
    const all = logs.join("\n");
    expect(all).toContain("[sms] sent test to ***0123");
    expect(all).toContain("[sms] send failed test to ***9876: network down");
    expect(all).not.toContain("2145550123");
    expect(all).not.toContain("secret-token");
  });

  it("falls back to From when no messaging service is set", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "t";
    process.env.TWILIO_PHONE_NUMBER = "+15550001111";
    process.env.HOST_ALERT_SMS_TO = "+12145550123";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    await sendHostSms("x", "t");
    const body = new URLSearchParams(String(fetchSpy.mock.calls[0][1]!.body));
    expect(body.get("From")).toBe("+15550001111");
    expect(body.get("MessagingServiceSid")).toBeNull();
  });

  it("masks and parses recipients", () => {
    expect(maskPhone("+12145550123")).toBe("***0123");
    expect(parseSmsRecipients("+12145550123;+12145550123 , 2145550000")).toEqual(["+12145550123"]);
  });
});

describe("booking flow texts", () => {
  beforeEach(() => {
    resetStore();
    clearMock();
    process.env.HOST_ALERT_SMS_TO = "+12145550123";
    setSmsSender({ send: async (to, body) => void texts.push({ to, body }) });
    setEmailSender({ send: async (m) => void sent.push(m) });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("texts the host when a booking is cancelled", async () => {
    const r = await createBookingRequest({
      spaceId: IDS.m1,
      startsAt: "2027-01-06T15:00:00.000Z",
      endsAt: "2027-01-06T17:00:00.000Z",
      guest: { name: "Grace Hopper", email: "grace@navy.mil" },
      clientRequestKey: `k-sms-${Date.now()}`,
    });
    if (!("booking" in r)) throw new Error(r.message);
    expect(texts.map((t) => t.body)[0]).toMatch(/^Cue: NEW request M1 Jan 6 9 AM–11 AM, Grace Hopper \(Navy\)/);
    texts = [];
    const c = await cancelBooking(r.booking.id, { actor: "guest" });
    expect("error" in c && c.error).toBeFalsy();
    expect(texts).toHaveLength(1);
    expect(texts[0].body).toMatch(/^Cue: CANCELLED by guest — M1 Jan 6 9 AM–11 AM, Grace Hopper \(Navy\)/);
    expect(sent.find((m) => m.template === "host_booking_cancelled")!.subject).toMatch(/^Cancelled: M1 Jan 6/);
  });
});

describe("host decision reminders", () => {
  const NOW = new Date("2027-01-04T15:00:00.000Z");
  const H = 60 * 60 * 1000;

  beforeEach(() => {
    resetStore();
    clearMock();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.HOST_EMAIL = "spp@thecue.work,darcy@thecue.work";
    process.env.HOST_ALERT_SMS_TO = "+12145550123";
    setSmsSender({ send: async (to, body) => void texts.push({ to, body }) });
    setEmailSender({ send: async (m) => void sent.push(m) });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => delete process.env.HOST_EMAIL);

  let slotN = 0;
  async function requested(deadlineInHours: number) {
    const hour = 15 + slotN++ * 2;
    const r = await createBookingRequest({
      spaceId: IDS.m3,
      startsAt: `2027-01-08T${hour}:00:00.000Z`,
      endsAt: `2027-01-08T${hour + 1}:00:00.000Z`,
      guest: { name: "Pat", email: "pat@gmail.com" },
      clientRequestKey: `k-rem-${Math.random().toString(36).slice(2)}`,
    });
    if (!("booking" in r)) throw new Error(r.message);
    getStore().updateBooking(r.booking.id, {
      status: "requested",
      hostActionDeadlineAt: new Date(NOW.getTime() + deadlineInHours * H).toISOString(),
    });
    sent = [];
    texts = [];
    return r.booking.id;
  }

  it("decides the due slot", () => {
    const at = (h: number) => new Date(NOW.getTime() + h * H).toISOString();
    expect(dueHostReminder({ status: "requested", hostActionDeadlineAt: at(7) }, NOW)).toBeNull();
    expect(dueHostReminder({ status: "requested", hostActionDeadlineAt: at(5) }, NOW)).toBe("6h");
    expect(dueHostReminder({ status: "requested", hostActionDeadlineAt: at(1.5) }, NOW)).toBe("2h");
    expect(dueHostReminder({ status: "requested", hostActionDeadlineAt: at(-1) }, NOW)).toBeNull();
    expect(dueHostReminder({ status: "accepted", hostActionDeadlineAt: at(1) }, NOW)).toBeNull();
    expect(
      dueHostReminder({ status: "requested", hostActionDeadlineAt: at(1), hostReminder2hSentAt: at(0) }, NOW)
    ).toBeNull();
  });

  it("sends one 6h then one 2h reminder, never duplicates", async () => {
    const id = await requested(5.9);
    expect((await sendHostDecisionReminders(NOW)).reminded).toEqual([{ id, slot: "6h" }]);
    expect((await sendHostDecisionReminders(new Date(NOW.getTime() + 0.25 * H))).reminded).toEqual([]);
    expect((await sendHostDecisionReminders(new Date(NOW.getTime() + 4 * H))).reminded).toEqual([{ id, slot: "2h" }]);
    expect((await sendHostDecisionReminders(new Date(NOW.getTime() + 4.5 * H))).reminded).toEqual([]);
    expect(sent.map((m) => m.template)).toEqual(["host_decision_reminder_6h", "host_decision_reminder_2h"]);
    expect(sent[0].to).toBe("spp@thecue.work,darcy@thecue.work");
    expect(sent[0].subject).toMatch(/^⏰ Reminder: booking request auto-declines in 5h 54m — M3 Jan 8/);
    expect(texts).toHaveLength(2);
    expect(texts[1].body).toMatch(/^Cue REMINDER: request M3 .* auto-declines in 1h 54m/);
  });

  it("only sends the 2h reminder when first seen inside 2h, and skips non-requested", async () => {
    const id = await requested(1.5);
    const gone = await requested(4);
    getStore().updateBooking(gone, { status: "accepted" });
    expect((await sendHostDecisionReminders(NOW)).reminded).toEqual([{ id, slot: "2h" }]);
    expect((await sendHostDecisionReminders(NOW)).reminded).toEqual([]);
    expect(sent).toHaveLength(1);
  });
});
