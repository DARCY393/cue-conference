import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createBookingRequest, acceptBooking, listHostBookings, sanitizeBookingForPublic } from "../lib/bookings";
import { setEmailSender, type EmailMessage } from "../lib/email";
import { IDS } from "../lib/seed";
import { resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";
import {
  getParkingRecipients,
  normalizePhone,
  parkingPagePath,
  resetParkingDemoState,
  saveParkingRecipients,
  sendDueParkingReminders,
  validateParkingRecipients,
  markParkingIssued,
  sendDueParkingStatusAlerts,
} from "../lib/parking-recipients";
import { renderParkingRecipientsRequestEmail } from "../lib/email-templates";
import { arrivalInstructionLines } from "../lib/arrival-instructions";
import { verifyBookingAccessToken } from "../lib/booking-access";

// Monday 2027-01-04, 9:00 CT = 15:00 UTC.
const MON_9AM = new Date("2027-01-04T15:00:00.000Z");
const H = 3600_000;

async function accepted(spaceId: string, startOffsetHours: number, parkingPasses: number, email = "guest@example.com") {
  const start = new Date(MON_9AM.getTime() + startOffsetHours * H);
  const requested = await createBookingRequest({
    spaceId,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 2 * H).toISOString(),
    guest: { name: "Guest", email },
    parkingPasses,
  } as Parameters<typeof createBookingRequest>[0]);
  if (!("booking" in requested)) throw new Error(JSON.stringify(requested));
  const res = await acceptBooking(requested.booking.id);
  if (!("booking" in res) || !res.booking) throw new Error("accept failed");
  return res.booking;
}

describe("parking recipient validation", () => {
  it("normalizes US and international phones", () => {
    expect(normalizePhone("(214) 555-0123")).toBe("+12145550123");
    expect(normalizePhone("1-214-555-0123")).toBe("+12145550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555-0123")).toBeNull();
    expect(normalizePhone("call me")).toBeNull();
  });

  it("one field per row: a mobile number OR an email; blank rows dropped; capped at passes", () => {
    expect(validateParkingRecipients([{ contact: "Ann" }], 2)).toMatchObject({ ok: false, row: 1 });
    expect(validateParkingRecipients([{ contact: "nope@" }], 2)).toMatchObject({ ok: false });
    const ok = validateParkingRecipients([{ contact: " 214 555 0123 " }, { contact: "" }, { contact: "Bob@Example.com" }], 2);
    expect(ok).toEqual({ ok: true, recipients: [{ phone: "+12145550123" }, { email: "bob@example.com" }] });
    expect(validateParkingRecipients([{ contact: "a@b.co" }, { contact: "c@d.co" }], 1)).toMatchObject({ ok: false });
  });
});

describe("parking recipients flow", () => {
  let sent: EmailMessage[];
  beforeEach(() => {
    resetStore();
    resetParkingDemoState();
    clearMock();
    vi.useFakeTimers();
    vi.setSystemTime(MON_9AM);
    sent = [];
    setEmailSender({ async send(m: EmailMessage) { sent.push(m); } });
  });
  afterEach(() => {
    vi.useRealTimers();
    setEmailSender(null);
  });

  it("emails the guest a tokenized link on accept (not at request time) and links it from the confirmation", async () => {
    const b = await accepted(IDS.m1, 24 * 3, 2, "p@example.com");
    expect(sent.filter((m) => m.template === "booking_requested").length).toBe(1);
    const req = sent.filter((m) => m.template === "parking_recipients_request");
    expect(req).toHaveLength(1);
    expect(req[0].to).toBe("p@example.com");
    expect(req[0].text).toContain(parkingPagePath(b.id));
    expect(sent.find((m) => m.template === "booking_accepted")?.text).toContain(parkingPagePath(b.id));
    const t = new URL("https://x" + parkingPagePath(b.id)).searchParams.get("t");
    expect(verifyBookingAccessToken(b.id, t)).toBe(true);
  });

  it("sends nothing parking-related when no passes were booked", async () => {
    await accepted(IDS.m1, 24 * 3, 0);
    expect(sent.some((m) => m.template.startsWith("parking_"))).toBe(false);
  });

  it("saves, updates, alerts the host each time, and shows recipients to staff only", async () => {
    const b = await accepted(IDS.m2, 24 * 3, 2);
    sent.length = 0;
    const r1 = await saveParkingRecipients(b.id, [{ contact: "214-555-0123" }]);
    expect(r1.ok).toBe(true);
    const r2 = await saveParkingRecipients(b.id, [{ contact: "214-555-0123" }, { contact: "bob@example.com" }]);
    expect(r2.ok).toBe(true);
    expect(await getParkingRecipients(b.id)).toHaveLength(2);
    const alerts = sent.filter((m) => m.template === "host_parking_recipients");
    expect(alerts).toHaveLength(2);
    expect(alerts[1].text).toContain("+12145550123");
    expect(alerts[1].text).toContain("bob@example.com");

    const host = (await listHostBookings({})).find((x) => x.id === b.id)!;
    expect(host.parkingRecipients).toHaveLength(2);
    expect(sanitizeBookingForPublic(host).parkingRecipients).toBeUndefined();
  });

  it("rejects saves with too many rows, empty lists, or after the booking starts", async () => {
    const b = await accepted(IDS.m3, 24 * 3, 1);
    expect(await saveParkingRecipients(b.id, [{ email: "a@b.co" }, { email: "c@d.co" }])).toMatchObject({ ok: false, status: 400 });
    expect(await saveParkingRecipients(b.id, [])).toMatchObject({ ok: false, status: 400 });
    const late = await saveParkingRecipients(b.id, [{ email: "a@b.co" }], new Date(MON_9AM.getTime() + 24 * 4 * H));
    expect(late).toMatchObject({ ok: false, status: 409 });
  });

  it("reminds once when the list is still empty 48h out; never when filled", async () => {
    const empty = await accepted(IDS.m1, 24 * 3, 2);
    const filled = await accepted(IDS.m4, 24 * 3, 1);
    await saveParkingRecipients(filled.id, [{ email: "a@b.co" }]);
    sent.length = 0;

    expect((await sendDueParkingReminders(MON_9AM)).remindedIds).toEqual([]); // >48h out
    const at = new Date(MON_9AM.getTime() + 24 * 2 * H); // 24h before start
    expect((await sendDueParkingReminders(at)).remindedIds).toEqual([empty.id]);
    expect((await sendDueParkingReminders(at)).remindedIds).toEqual([]);
    expect(sent.filter((m) => m.template === "parking_recipients_reminder")).toHaveLength(1);
  });

  it("does not send a second reminder when accepted inside the 48h window", async () => {
    const b = await accepted(IDS.m1, 3, 1);
    expect(sent.filter((m) => m.template === "parking_recipients_request")).toHaveLength(1);
    expect((await sendDueParkingReminders(MON_9AM)).remindedIds).not.toContain(b.id);
  });
});

describe("24h parking status host email", () => {
  let sent: EmailMessage[];
  beforeEach(() => {
    resetStore();
    resetParkingDemoState();
    clearMock();
    vi.useFakeTimers();
    vi.setSystemTime(MON_9AM);
    sent = [];
    setEmailSender({ async send(m: EmailMessage) { sent.push(m); } });
  });
  afterEach(() => {
    vi.useRealTimers();
    setEmailSender(null);
  });

  it("sends NOT ISSUED once at 24h with 'not submitted' when nothing happened", async () => {
    const b = await accepted(IDS.m1, 24 * 3, 2);
    expect((await sendDueParkingStatusAlerts(new Date(MON_9AM.getTime() + 24 * H))).sentIds).toEqual([]);
    const at = new Date(MON_9AM.getTime() + 49 * H);
    expect((await sendDueParkingStatusAlerts(at)).sentIds).toEqual([b.id]);
    expect((await sendDueParkingStatusAlerts(at)).sentIds).toEqual([]);
    const m = sent.filter((x) => x.template === "host_parking_status");
    expect(m).toHaveLength(1);
    expect(m[0].subject).toContain("NOT ISSUED");
    expect(m[0].text).toContain("Guest has not submitted names yet");
  });

  it("says ISSUED with the recipient list after staff marks it, and undo works", async () => {
    const b = await accepted(IDS.m2, 24 * 3, 2);
    await saveParkingRecipients(b.id, [{ contact: "ann@example.com" }]);
    const r = await markParkingIssued(b.id, { by: "darcy@thecue.work" });
    expect(r.ok && r.meta.issuedAt).toBeTruthy();
    const host = (await listHostBookings({})).find((x) => x.id === b.id)!;
    expect(host.parkingPassesIssuedAt).toBeTruthy();
    await sendDueParkingStatusAlerts(new Date(MON_9AM.getTime() + 49 * H));
    const m = sent.find((x) => x.template === "host_parking_status")!;
    expect(m.subject).toMatch(/Parking passes ISSUED/);
    expect(m.text).toContain("1 of 2");
    expect(m.text).toContain("ann@example.com");
    const undo = await markParkingIssued(b.id, { issued: false });
    expect(undo.ok && undo.meta.issuedAt).toBeFalsy();
  });

  it("goes out on the next run when accepted inside 24h; skips bookings without parking", async () => {
    const b = await accepted(IDS.m1, 3, 1);
    await accepted(IDS.m2, 3, 0);
    expect((await sendDueParkingStatusAlerts(MON_9AM)).sentIds).toEqual([b.id]);
    expect(await markParkingIssued((await accepted(IDS.m3, 3, 0)).id)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("parking copy", () => {
  it("states no-marketing, QR at the gate, and the entrance location", () => {
    const { text, html } = renderParkingRecipientsRequestEmail({
      roomName: "M2",
      startsAt: MON_9AM.toISOString(),
      endsAt: new Date(MON_9AM.getTime() + 2 * H).toISOString(),
      parkingPasses: 2,
      url: "https://book.thecue.work/bookings/x/parking?t=y",
    });
    for (const s of [text, html]) {
      expect(s.replace(/&#39;/g, "'")).toContain("won't be used for marketing");
      expect(s).toContain("QR code");
      expect(s).toContain("gate");
      expect(s).toContain("750 N Saint Paul St, Dallas, TX 75201");
      expect(s).toContain("east side of Saint Paul St just south of Ross");
      expect(s.toLowerCase()).toContain("mobile number or email");
    }
    expect(html).not.toMatch(/gold/i);
  });

  it("arrival instructions give the garage entrance when parking was booked", () => {
    const lines = arrivalInstructionLines({ roomName: "M2", parkingPasses: 2 }).join("\n");
    expect(lines).toContain("east side of Saint Paul St just south of Ross");
  });
});
