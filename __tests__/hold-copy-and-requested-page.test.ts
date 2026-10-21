import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FREE_CANCELLATION_TEXT,
  HOLD_HEADING,
  WHAT_HAPPENS_NEXT,
  holdBodyText,
  holdButtonLabel,
} from "../lib/hold-copy";
import {
  renderBookingConfirmationEmail,
  renderBookingDeclinedEmail,
  renderBookingRequestedEmail,
  type BookingEmailParams,
} from "../lib/email-templates";
import { bookingAccessToken, requestedPagePath, verifyBookingAccessToken } from "../lib/booking-access";
import { createBookingRequest, getBookingById, sanitizeBookingForPublic } from "../lib/bookings";
import { setEmailSender } from "../lib/email";
import { IDS } from "../lib/seed";
import { resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";
import RequestedPage from "../app/bookings/[bookingId]/requested/page";
import { GET as getBookingRoute } from "../app/api/v1/bookings/[bookingId]/route";
import { POST as createBookingRoute } from "../app/api/v1/bookings/route";

const PARAMS: BookingEmailParams = {
  roomName: "M2",
  startsAt: "2027-01-04T15:00:00.000Z",
  endsAt: "2027-01-04T21:00:00.000Z",
  totalCents: 81_000,
  parkingPasses: 2,
  parkingCents: 4_000,
  bookingId: "11111111-1111-4111-8111-111111111111",
  subtotalCents: 90_000,
  discountCents: 13_000,
  discountLabel: "Long booking discount (20%)",
};

describe("hold copy", () => {
  it("states the hold amount, that nothing is charged now, and the release rules", () => {
    const body = holdBodyText(45_000);
    expect(HOLD_HEADING).toBe("Your card won't be charged yet");
    expect(body).toContain("temporary hold of $450.00");
    expect(body).toContain("You're only charged if we confirm your booking");
    expect(body).toContain("don't respond within 24 hours, the hold is released automatically");
    expect(body).toContain("a few days to disappear from your statement");
    expect(FREE_CANCELLATION_TEXT).toBe("Free cancellation up to 48 hours before your booking.");
  });

  it("puts the hold amount on the submit button", () => {
    expect(holdButtonLabel(45_000)).toBe("Request booking – hold $450.00");
    expect(holdButtonLabel(undefined)).not.toMatch(/pay/i);
  });

  it("has the four 'what happens next' steps in order", () => {
    expect(WHAT_HAPPENS_NEXT.map((s) => s.title)).toEqual([
      "We review your request",
      "If approved, your card is charged",
      "If we can't host you, nothing is charged",
      "Free cancellation",
    ]);
    expect(WHAT_HAPPENS_NEXT[0].body).toContain("at most 24 hours");
    expect(WHAT_HAPPENS_NEXT[1].body).toMatch(/arrival instructions, Wi-Fi and parking/);
  });
});

describe("room page wording", () => {
  const src = readFileSync(join(__dirname, "../app/spaces/[slug]/page.tsx"), "utf8");
  it("no longer says Pay / Confirm Payment / Payment confirmed", () => {
    expect(src).not.toContain("Confirm Payment");
    expect(src).not.toContain("Pay to confirm");
    expect(src).not.toContain("Payment confirmed");
    expect(src).not.toContain("Continue to payment");
  });
  it("shows the hold notice and the hold-amount button, and redirects to the requested page", () => {
    expect(src).toContain("<HoldNotice");
    expect(src).toContain("holdButtonLabel(totalCents)");
    expect(src).toMatch(/router\.push\(confirmationUrl\)/);
  });
  it("shows the server-authorized amount once the hold exists, and ignores stale quote responses", () => {
    expect(src).toContain("<HoldNotice totalCents={hold.totalCents} />");
    expect(src).toContain("totalCents={hold.totalCents}");
    expect(src).toContain("if (seq !== quoteSeqRef.current) return;");
  });
});

describe("request-received email", () => {
  it("uses the hold language and never implies an immediate charge", () => {
    const { subject, text, html } = renderBookingRequestedEmail(PARAMS);
    expect(subject).toMatch(/^Request received/);
    expect(subject).toContain("not charged");
    for (const out of [text, html.replace(/&#39;/g, "'")]) {
      expect(out).toContain(HOLD_HEADING);
      expect(out).toContain("temporary hold of $810.00");
      expect(out).toContain(FREE_CANCELLATION_TEXT);
      expect(out).toContain("What happens next");
      expect(out).toContain("214-883-4174");
      expect(out).not.toMatch(/payment hold|\bpaid\b|\bpay\b/i);
    }
    expect(text).toContain("Hold amount (not charged yet): $810.00");
    expect(text).toContain("Long booking discount (20%): −$130.00");
    expect(text).not.toMatch(/Wi-Fi: network|password/i);
  });

  it("confirmation email says the hold has now been charged; decline says released", () => {
    expect(renderBookingConfirmationEmail(PARAMS).text).toContain("hold on your card has now been charged");
    expect(renderBookingDeclinedEmail(PARAMS).text).toContain("hold on your card has been released");
  });
});

describe("booking access token", () => {
  it("verifies only the exact booking id + token", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const t = bookingAccessToken(id);
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(verifyBookingAccessToken(id, t)).toBe(true);
    expect(verifyBookingAccessToken(id, t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBe(false);
    expect(verifyBookingAccessToken("33333333-3333-4333-8333-333333333333", t)).toBe(false);
    expect(verifyBookingAccessToken(id, undefined)).toBe(false);
    expect(requestedPagePath(id)).toBe(`/bookings/${id}/requested?t=${t}`);
  });
});

describe("requested page + public API (demo mode)", () => {
  beforeEach(() => {
    resetStore();
    clearMock();
    vi.restoreAllMocks();
    setEmailSender({ send: async () => undefined });
  });

  async function makeRequested() {
    const r = await createBookingRequest({
      spaceId: IDS.m2,
      startsAt: "2027-01-06T15:00:00.000Z",
      endsAt: "2027-01-06T23:00:00.000Z",
      parkingPasses: 1,
      guest: { name: "Ada Lovelace", email: "ada@example.com" },
      clientRequestKey: "k-requested-page-1",
    });
    if (!("booking" in r)) throw new Error(r.message);
    return r.booking;
  }

  it("create route returns an unguessable confirmation URL and no guest PII", async () => {
    const req = new Request("http://x/api/v1/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId: IDS.m2,
        startsAt: "2027-01-07T15:00:00.000Z",
        endsAt: "2027-01-07T17:00:00.000Z",
        guest: { name: "Ada Lovelace", email: "ada@example.com" },
        clientRequestKey: "k-route-1",
      }),
    });
    const res = await createBookingRoute(req as never);
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.confirmationUrl).toBe(requestedPagePath(data.booking.id));
    expect(data.booking.guestEmail).toBeUndefined();
  });

  it("GET /bookings/:id does not expose the guest's name or email", async () => {
    const b = await makeRequested();
    const res = await getBookingRoute(new Request("http://x") as never, { params: Promise.resolve({ bookingId: b.id }) });
    const data = await res.json();
    expect(data.id).toBe(b.id);
    expect(data.guestEmail).toBeUndefined();
    expect(data.guestName).toBeUndefined();
    expect(sanitizeBookingForPublic({ ...b, guestEmail: "x@y.z" }).guestEmail).toBeUndefined();
  });

  it("renders the summary, timeline, emailed-copy note and questions block — no Wi-Fi password", async () => {
    const b = await makeRequested();
    const full = await getBookingById(b.id);
    expect(full?.status).toBe("requested");
    const el = await RequestedPage({
      params: Promise.resolve({ bookingId: b.id }),
      searchParams: Promise.resolve({ t: bookingAccessToken(b.id) }),
    });
    const html = renderToStaticMarkup(el).replace(/&#x27;|&#39;/g, "'");
    expect(html).toContain("Request received");
    expect(html).toContain("M2");
    expect(html).toContain("Wed, Jan 6, 2027");
    expect(html).toContain("9:00 AM – 5:00 PM CT");
    expect(html).toContain("8 hrs");
    expect(html).toContain("M2 Meeting Room");
    expect(html).not.toContain("M2 · M2");
    expect(html).toContain("1 pass");
    expect(html).toMatch(/Long booking discount \(\d+%\)/);
    expect(html).toContain("Hold amount (not charged)");
    expect(html).toContain(`$${(b.totalCents / 100).toFixed(2)}`);
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("emailed a copy");
    for (const s of WHAT_HAPPENS_NEXT) expect(html).toContain(s.title);
    expect(html).toContain('href="tel:+12148834174"');
    expect(html).toContain("suite 212");
    expect(html).not.toMatch(/password/i);
  });

  it("404s without the right token, so the id alone reveals nothing", async () => {
    const b = await makeRequested();
    for (const t of [undefined, "nope", bookingAccessToken("someone-else")]) {
      await expect(
        RequestedPage({ params: Promise.resolve({ bookingId: b.id }), searchParams: Promise.resolve({ t }) })
      ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
    }
  });
});
