import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { acceptBooking, cancelBooking, createBookingRequest, getBookingById } from "../lib/bookings";
import { bookingAccessToken, cancelPagePath, cancelPageUrl } from "../lib/booking-access";
import { previewCancellation } from "../lib/cancellation";
import { setEmailSender, type EmailMessage } from "../lib/email";
import { renderBookingReminderEmail } from "../lib/email-templates";
import { sendDueReminders } from "../lib/reminders";
import * as stripeLib from "../lib/stripe";
import { IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";
import { clearMock, getMockEvents } from "../lib/google-calendar";
import { STAFF_SESSION_COOKIE, buildSessionCookieValue, loginStaff, upsertStaffUser } from "../lib/staff-auth";
import { POST as cancelRoute } from "../app/api/v1/bookings/[bookingId]/cancel/route";
import { GET as hostPreviewRoute, POST as hostCancelRoute } from "../app/api/v1/host/bookings/[bookingId]/cancel/route";
import CancelPage from "../app/bookings/[bookingId]/cancel/page";

// Suite clock: Tue 2026-12-01 18:00Z (12:00 PM CT).
const FAR = { startsAt: "2027-01-06T15:00:00.000Z", endsAt: "2027-01-06T17:00:00.000Z" }; // weeks out
const SOON = { startsAt: "2026-12-02T15:00:00.000Z", endsAt: "2026-12-02T17:00:00.000Z" }; // 21h out

let sent: EmailMessage[] = [];
let n = 0;

async function makeBooking(window = FAR, email = "guest@example.com") {
  const r = await createBookingRequest({
    spaceId: IDS.m2,
    ...window,
    guest: { name: "Grace Hopper", email },
    clientRequestKey: `k-cancel-${++n}-${Date.now()}`,
  });
  if (!("booking" in r)) throw new Error(r.message);
  return r.booking;
}

async function makeAccepted(window = FAR) {
  const b = await makeBooking(window);
  const a = await acceptBooking(b.id);
  if (!("booking" in a) || !a.booking) throw new Error("accept failed");
  return a.booking;
}

function req(bookingId: string, body: unknown, opts: { query?: string; cookie?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.cookie) headers.set("cookie", `${STAFF_SESSION_COOKIE}=${opts.cookie}`);
  return new NextRequest(`http://localhost/api/v1/bookings/${bookingId}/cancel${opts.query ?? ""}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (bookingId: string) => ({ params: Promise.resolve({ bookingId }) });

async function staffCookie() {
  await upsertStaffUser({ email: "staff@example.com", name: "Staff", password: "correct-password-1" });
  const login = await loginStaff("staff@example.com", "correct-password-1");
  if (!login.ok) throw new Error("login failed");
  return buildSessionCookieValue(login.token);
}

beforeEach(() => {
  resetStore();
  clearMock();
  vi.restoreAllMocks();
  sent = [];
  setEmailSender({ send: async (m) => void sent.push(m) });
  process.env.HOST_EMAIL = "spp@thecue.work";
  process.env.NEXT_PUBLIC_APP_URL = "https://preview.example.com";
});
afterEach(() => {
  setEmailSender(null);
  delete process.env.HOST_EMAIL;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("POST /api/v1/bookings/:id/cancel — authorization", () => {
  it("404s with no token, a wrong token, or another booking's token — and changes nothing", async () => {
    const b = await makeBooking();
    const other = await makeBooking({ startsAt: "2027-01-07T15:00:00.000Z", endsAt: "2027-01-07T17:00:00.000Z" });
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const releaseSpy = vi.spyOn(stripeLib, "cancelPaymentIntent");
    for (const r of [
      req(b.id, undefined),
      req(b.id, {}),
      req(b.id, { token: "nope" }),
      req(b.id, { token: bookingAccessToken(other.id) }),
      req(b.id, {}, { query: `?t=${bookingAccessToken(b.id).slice(0, -2)}xx` }),
    ]) {
      const res = await cancelRoute(r, ctx(b.id));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain(b.id);
      expect(JSON.stringify(body)).not.toContain("guest@example.com");
    }
    // unknown booking id looks identical
    const unknown = await cancelRoute(req("00000000-0000-4000-8000-000000000000", { token: "x" }), ctx("00000000-0000-4000-8000-000000000000"));
    expect(unknown.status).toBe(404);
    expect((await getBookingById(b.id))?.status).toBe("requested");
    expect(refundSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("the guest token (body or ?t=) cancels, without leaking guest PII", async () => {
    const b = await makeBooking();
    const res = await cancelRoute(req(b.id, { token: bookingAccessToken(b.id) }), ctx(b.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.booking.status).toBe("cancelled");
    expect(data.action).toBe("release_hold");
    expect(data.booking.guestEmail).toBeUndefined();

    const b2 = await makeBooking({ startsAt: "2027-01-08T15:00:00.000Z", endsAt: "2027-01-08T17:00:00.000Z" });
    const res2 = await cancelRoute(req(b2.id, undefined, { query: `?t=${bookingAccessToken(b2.id)}` }), ctx(b2.id));
    expect(res2.status).toBe(200);
  });

  it("a staff session cancels without a token; a guest can't use the courtesy override", async () => {
    const cookie = await staffCookie();
    const soon = await makeAccepted(SOON);
    const guestTry = await cancelRoute(
      req(soon.id, { token: bookingAccessToken(soon.id), courtesyFullRefund: true }),
      ctx(soon.id)
    );
    const g = await guestTry.json();
    expect(g.action).toBe("no_refund");
    expect(g.refundCents).toBe(0);

    const soon2 = await makeAccepted({ startsAt: "2026-12-02T18:00:00.000Z", endsAt: "2026-12-02T20:00:00.000Z" });
    const staffRes = await cancelRoute(req(soon2.id, { courtesyFullRefund: true }, { cookie }), ctx(soon2.id));
    expect(staffRes.status).toBe(200);
    const s = await staffRes.json();
    expect(s.action).toBe("refund");
    expect(s.refundCents).toBe(soon2.totalCents);
  });

  it("host cancel routes require staff", async () => {
    const b = await makeBooking();
    const anon = new NextRequest(`http://localhost/api/v1/host/bookings/${b.id}/cancel`, { method: "POST" });
    expect((await hostCancelRoute(anon, ctx(b.id))).status).toBe(401);
    expect((await hostPreviewRoute(new NextRequest(`http://localhost/x`), ctx(b.id))).status).toBe(401);
  });
});

describe("refund calculation paths", () => {
  it("pending request → hold released, no refund call", async () => {
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const releaseSpy = vi.spyOn(stripeLib, "cancelPaymentIntent");
    const b = await makeBooking();
    const r = await cancelBooking(b.id, { actor: "guest" });
    if (!("booking" in r)) throw new Error(r.message);
    expect(r.action).toBe("release_hold");
    expect(r.refundCents).toBe(0);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it("accepted ≥48h → full refund with a per-booking idempotency key", async () => {
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const b = await makeAccepted();
    const r = await cancelBooking(b.id, { actor: "guest" });
    if (!("booking" in r)) throw new Error(r.message);
    expect(r.action).toBe("refund");
    expect(r.refundCents).toBe(b.totalCents);
    expect(refundSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: b.totalCents, idempotencyKey: `booking-cancel-refund:${b.id}` })
    );
    const stored = await getBookingById(b.id);
    expect(stored?.refundCents).toBe(b.totalCents);
    expect(stored?.cancellationAction).toBe("refund");
    expect(stored?.cancelledBy).toBe("guest");
  });

  it("accepted <48h → no refund for the guest; staff courtesy override → full refund", async () => {
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const a = await makeAccepted(SOON);
    const r = await cancelBooking(a.id, { actor: "guest" });
    if (!("booking" in r)) throw new Error(r.message);
    expect(r.action).toBe("no_refund");
    expect(refundSpy).not.toHaveBeenCalled();

    const b = await makeAccepted({ startsAt: "2026-12-02T18:00:00.000Z", endsAt: "2026-12-02T20:00:00.000Z" });
    const policy = await cancelBooking(b.id, { actor: "staff", courtesyFullRefund: true });
    if (!("booking" in policy)) throw new Error(policy.message);
    expect(policy.action).toBe("refund");
    expect(policy.refundCents).toBe(b.totalCents);
    expect(refundSpy).toHaveBeenCalledTimes(1);
  });

  it("preview matches the server outcome", () => {
    const now = new Date("2026-12-01T18:00:00.000Z");
    expect(previewCancellation({ status: "requested", startsAt: FAR.startsAt, totalCents: 5000 }, { now }).action).toBe("release_hold");
    expect(previewCancellation({ status: "accepted", startsAt: FAR.startsAt, totalCents: 5000 }, { now })).toMatchObject({ action: "refund", refundCents: 5000 });
    expect(previewCancellation({ status: "accepted", startsAt: SOON.startsAt, totalCents: 5000 }, { now })).toMatchObject({ action: "no_refund", refundCents: 0 });
    expect(previewCancellation({ status: "accepted", startsAt: SOON.startsAt, totalCents: 5000 }, { now, courtesyFullRefund: true })).toMatchObject({ action: "refund", refundCents: 5000 });
    expect(previewCancellation({ status: "declined", startsAt: FAR.startsAt, totalCents: 5000 }, { now }).cancellable).toBe(false);
    expect(previewCancellation({ status: "accepted", startsAt: "2026-12-01T17:00:00.000Z", totalCents: 5000 }, { now }).blockedReason).toBe("started");
  });

  it("guest can't cancel once the booking has started; declined bookings aren't cancellable", async () => {
    const b = await makeAccepted(SOON);
    vi.setSystemTime(new Date("2026-12-02T15:30:00.000Z"));
    const r = await cancelBooking(b.id, { actor: "guest" });
    expect("error" in r && r.error).toBe("start_passed");
    getStore().updateBooking(b.id, { status: "declined" });
    const d = await cancelBooking(b.id, { actor: "staff" });
    expect("error" in d && d.error).toBe("invalid_status");
  });
});

describe("idempotency", () => {
  it("double click / concurrent cancels refund exactly once", async () => {
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const b = await makeAccepted();
    const results = await Promise.all([
      cancelBooking(b.id, { actor: "guest" }),
      cancelBooking(b.id, { actor: "guest" }),
      cancelBooking(b.id, { actor: "staff", courtesyFullRefund: true }),
    ]);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => "booking" in r && !r.alreadyCancelled)).toHaveLength(1);
    // a later click returns the stored outcome, still no second refund
    const again = await cancelBooking(b.id, { actor: "guest" });
    if (!("booking" in again)) throw new Error(again.message);
    expect(again.alreadyCancelled).toBe(true);
    expect(again.refundCents).toBe(b.totalCents);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    // one guest email + one host alert, not three
    expect(sent.filter((m) => m.template === "booking_cancelled")).toHaveLength(1);
    expect(sent.filter((m) => m.template === "host_booking_cancelled")).toHaveLength(1);
  });

  it("route double POST: second response is a 200 already-cancelled, no second refund", async () => {
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const b = await makeAccepted();
    const t = bookingAccessToken(b.id);
    const first = await (await cancelRoute(req(b.id, { token: t }), ctx(b.id))).json();
    const second = await (await cancelRoute(req(b.id, { token: t }), ctx(b.id))).json();
    expect(first.alreadyCancelled).toBe(false);
    expect(second.alreadyCancelled).toBe(true);
    expect(second.refundCents).toBe(first.refundCents);
    expect(refundSpy).toHaveBeenCalledTimes(1);
  });

  it("a retry after a crash skips the refund if Stripe already shows it refunded", async () => {
    const b = await makeAccepted();
    // simulate: earlier attempt refunded at Stripe, then died before saving (stale claim)
    getStore().updateBooking(b.id, { cancelClaimedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    vi.spyOn(stripeLib, "getRefundedCents").mockResolvedValue(b.totalCents);
    const refundSpy = vi.spyOn(stripeLib, "createRefund");
    const r = await cancelBooking(b.id, { actor: "guest" });
    if (!("booking" in r)) throw new Error(r.message);
    expect(r.booking.status).toBe("cancelled");
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it("a fresh in-flight claim blocks a second cancel and an accept", async () => {
    const b = await makeBooking();
    getStore().updateBooking(b.id, { cancelClaimedAt: new Date().toISOString() });
    const r = await cancelBooking(b.id, { actor: "guest" });
    expect("error" in r && r.error).toBe("cancel_in_progress");
    const a = await acceptBooking(b.id);
    expect("error" in a && a.error).toBe("cancel_in_progress");
  });

  it("a Stripe failure leaves the booking untouched and retryable", async () => {
    const b = await makeAccepted();
    vi.spyOn(stripeLib, "createRefund").mockRejectedValueOnce(new Error("stripe down"));
    const r = await cancelBooking(b.id, { actor: "guest" });
    expect("error" in r && r.status).toBe(502);
    expect((await getBookingById(b.id))?.status).toBe("accepted");
    const retry = await cancelBooking(b.id, { actor: "guest" });
    expect("booking" in retry && retry.booking.status).toBe("cancelled");
  });
});

describe("side effects + email links", () => {
  it("cancel frees the calendar + availability, emails the guest and alerts the host", async () => {
    const b = await makeAccepted();
    const before = await getBookingById(b.id);
    expect(before?.googleEventId).toBeTruthy();
    sent = [];
    await cancelBooking(b.id, { actor: "guest" });
    expect(getMockEvents().some((e) => e.id === before?.googleEventId)).toBe(false);
    expect(getStore().getBusy(IDS.m2).some((x) => x.startsAt === b.startsAt)).toBe(false);
    const guest = sent.find((m) => m.template === "booking_cancelled")!;
    expect(guest.to).toBe("guest@example.com");
    expect(guest.text).toContain(`$${(b.totalCents / 100).toFixed(2)}`);
    const host = sent.find((m) => m.template === "host_booking_cancelled")!;
    expect(host.to).toBe("spp@thecue.work");
    expect(host.subject).toMatch(/^Cancelled: M2 .* — Grace Hopper — refund .* \(by guest\)$/);
    expect(host.text).toContain("Refunded");
  });

  it("request-received and confirmation emails carry the tokenized cancel link (HTML + text)", async () => {
    const b = await makeBooking();
    const url = cancelPageUrl(b.id);
    expect(url).toBe(`https://preview.example.com/bookings/${b.id}/cancel?t=${bookingAccessToken(b.id)}`);
    const requested = sent.find((m) => m.template === "booking_requested")!;
    expect(requested.text).toContain(`Cancel booking: ${url}`);
    expect(requested.html).toContain(`href="${url}"`);
    const hostNew = sent.find((m) => m.template === "host_new_request")!;
    expect(hostNew.html).not.toContain("/cancel?t="); // the host never gets the guest's token
    await acceptBooking(b.id);
    const confirmed = sent.find((m) => m.template === "booking_accepted")!;
    expect(confirmed.text).toContain(url);
    expect(confirmed.html).toContain(`href="${url}"`);
  });

  it("24h reminder carries the cancel link", async () => {
    const b = await makeAccepted(SOON);
    sent = [];
    await sendDueReminders(new Date("2026-12-01T18:00:00.000Z"));
    const reminder = sent.find((m) => m.template === "booking_reminder");
    expect(reminder).toBeTruthy();
    expect(reminder!.text).toContain(cancelPageUrl(b.id));
    expect(reminder!.html).toContain(`href="${cancelPageUrl(b.id)}"`);
    const r = renderBookingReminderEmail({
      roomName: "M2", startsAt: SOON.startsAt, endsAt: SOON.endsAt, totalCents: 100, parkingPasses: 0, parkingCents: 0, bookingId: "x",
    });
    expect(r.text).not.toContain("Cancel booking:");
  });
});

describe("guest cancel page", () => {
  async function render(bookingId: string, t?: string) {
    const el = await CancelPage({ params: Promise.resolve({ bookingId }), searchParams: Promise.resolve({ t }) });
    return renderToStaticMarkup(el).replace(/&#x27;|&#39;/g, "'");
  }

  it("shows room, date/time, status and exact outcome", async () => {
    const pending = await makeBooking();
    const html = await render(pending.id, bookingAccessToken(pending.id));
    expect(html).toContain("Cancel your booking?");
    expect(html).toContain("M2 Conference Room");
    expect(html).toContain("Wed, Jan 6, 2027");
    expect(html).toContain("9:00 AM – 11:00 AM CT");
    expect(html).toContain("Request pending");
    expect(html).toContain("Hold released");
    expect(html).toContain("cancel-confirm-button");

    const acc = await makeAccepted({ startsAt: "2027-01-07T15:00:00.000Z", endsAt: "2027-01-07T17:00:00.000Z" });
    expect(await render(acc.id, bookingAccessToken(acc.id))).toContain(`Full refund $${(acc.totalCents / 100).toFixed(2)}`);
    const soon = await makeAccepted(SOON);
    expect(await render(soon.id, bookingAccessToken(soon.id))).toContain("No refund");
  });

  it("invalid token shows a friendly page with no booking details", async () => {
    const b = await makeBooking();
    const html = await render(b.id, "bad");
    expect(html).toContain("This link isn't valid");
    expect(html).not.toContain("M2 Conference Room");
    expect(html).not.toContain("Grace");
  });

  it("already-cancelled, declined and past bookings render gracefully", async () => {
    const b = await makeAccepted();
    await cancelBooking(b.id, { actor: "guest" });
    const html = await render(b.id, bookingAccessToken(b.id));
    expect(html).toContain("Booking cancelled");
    expect(html).toContain("refunded");
    expect(html).not.toContain("cancel-confirm-button");

    const d = await makeBooking({ startsAt: "2027-01-08T15:00:00.000Z", endsAt: "2027-01-08T17:00:00.000Z" });
    getStore().updateBooking(d.id, { status: "declined" });
    expect(await render(d.id, bookingAccessToken(d.id))).toContain("nothing to cancel");

    const p = await makeAccepted(SOON);
    vi.setSystemTime(new Date("2026-12-02T16:00:00.000Z"));
    expect(await render(p.id, bookingAccessToken(p.id))).toContain("already started or passed");
  });

  it("cancel path helper", () => {
    expect(cancelPagePath("abc")).toBe(`/bookings/abc/cancel?t=${bookingAccessToken("abc")}`);
    void createElement;
  });
});
