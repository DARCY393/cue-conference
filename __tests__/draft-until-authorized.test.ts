import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeBooking,
  createBookingRequest,
  discardDraftBooking,
  DRAFT_TTL_MINUTES,
  expireOverdueRequests,
  listHostBookings,
} from "../lib/bookings";
import * as stripeLib from "../lib/stripe";
import { setEmailSender } from "../lib/email";
import { IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";

// Wed 2027-01-06 10:00 America/Chicago = 16:00 UTC.
const SLOT = { startsAt: "2027-01-06T16:00:00.000Z", endsAt: "2027-01-06T17:00:00.000Z" };
const GUEST = { name: "Ada Lovelace", email: "ada@example.com" };

let sent: { to: string; template: string }[];
let piStatus: Record<string, string>;
let piSeq: number;
let cancelSpy: { mock: { calls: unknown[][] } };

/** Simulate real (non-mock) Stripe: PIs start unconfirmed; tests flip them to requires_capture. */
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
  cancelSpy = vi.spyOn(stripeLib, "cancelPaymentIntent").mockImplementation(async (id: string) => {
    piStatus[id] = "canceled";
    return { id, status: "canceled" } as never;
  });
}
let piAmount: Record<string, number>;

beforeEach(() => {
  resetStore();
  clearMock();
  vi.restoreAllMocks();
  sent = [];
  piStatus = {};
  piAmount = {};
  piSeq = 0;
  setEmailSender({
    send: async (m: { to: string; template: string }) => {
      sent.push({ to: m.to, template: m.template });
    },
  } as never);
});
afterEach(() => setEmailSender(null));

describe("nothing is sent until the card is authorized", () => {
  it("creating the booking makes a silent draft: no emails, hidden from staff, slot not held", async () => {
    useRealishStripe();
    const res = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST, clientRequestKey: "key-aaaaaaaa" });
    if (!("booking" in res)) throw new Error(res.message);
    expect(res.booking.status).toBe("draft");
    expect(sent).toEqual([]);
    expect((await listHostBookings({})).map((b) => b.id)).not.toContain(res.booking.id);
    // Another guest can still start a checkout for the same slot (drafts don't hold inventory).
    const other = await createBookingRequest({
      spaceId: IDS.m1,
      ...SLOT,
      guest: { name: "Grace Hopper", email: "grace@example.com" },
      clientRequestKey: "key-bbbbbbbb",
    });
    expect("booking" in other).toBe(true);
  });

  it("authorize refuses an unconfirmed PaymentIntent and sends nothing", async () => {
    useRealishStripe();
    const res = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST });
    if (!("booking" in res)) throw new Error(res.message);
    const auth = await authorizeBooking(res.booking.id);
    expect(auth).toMatchObject({ error: "payment_not_authorized", status: 409 });
    expect(getStore().getBooking(res.booking.id)!.status).toBe("draft");
    expect(sent).toEqual([]);
  });

  it("an authorized hold promotes the draft once: guest + host emails exactly once", async () => {
    useRealishStripe();
    const res = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST });
    if (!("booking" in res)) throw new Error(res.message);
    piStatus[res.stripe.paymentIntentId] = "requires_capture";

    const first = await authorizeBooking(res.booking.id);
    if ("error" in first) throw new Error(first.message);
    expect(first.alreadyAuthorized).toBe(false);
    expect(first.booking.status).toBe("requested");
    expect(first.booking.hostActionDeadlineAt).toBeTruthy();
    expect(sent.map((m) => m.template).sort()).toEqual(["booking_requested", "host_new_request"]);
    expect(sent.find((m) => m.template === "booking_requested")!.to).toBe(GUEST.email);

    // Browser + webhook both calling it must not duplicate the emails.
    const again = await authorizeBooking(res.booking.id);
    expect(again).toMatchObject({ alreadyAuthorized: true });
    expect(sent).toHaveLength(2);
    expect((await listHostBookings({})).map((b) => b.id)).toContain(res.booking.id);
  });

  it("refuses when the authorized amount doesn't match the booking", async () => {
    useRealishStripe();
    const res = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST });
    if (!("booking" in res)) throw new Error(res.message);
    piStatus[res.stripe.paymentIntentId] = "requires_capture";
    piAmount[res.stripe.paymentIntentId] = 1;
    expect(await authorizeBooking(res.booking.id)).toMatchObject({ error: "amount_mismatch" });
    expect(sent).toEqual([]);
  });
});

describe("double submits and changed details", () => {
  it("the same request key returns the same draft and creates one PaymentIntent", async () => {
    useRealishStripe();
    const body = { spaceId: IDS.m1, ...SLOT, guest: GUEST, clientRequestKey: "dbl-click-1" };
    const [a, b] = await Promise.all([createBookingRequest(body), createBookingRequest(body)]);
    const c = await createBookingRequest(body);
    if (!("booking" in a) || !("booking" in b) || !("booking" in c)) throw new Error("expected bookings");
    expect(new Set([a.booking.id, b.booking.id, c.booking.id]).size).toBe(1);
    expect(getStore().bookings.filter((x) => x.status === "draft")).toHaveLength(1);
    // A racing duplicate may have created a PI, but any extra one is cancelled immediately.
    const open = Object.values(piStatus).filter((s) => s !== "canceled");
    expect(open).toHaveLength(1);
  });

  it("a new attempt for the same guest + slot replaces the old draft and cancels its PI", async () => {
    useRealishStripe();
    const first = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST, clientRequestKey: "attempt-one" });
    const second = await createBookingRequest({
      spaceId: IDS.m1,
      ...SLOT,
      guest: GUEST,
      parkingPasses: 1,
      clientRequestKey: "attempt-two",
    });
    if (!("booking" in first) || !("booking" in second)) throw new Error("expected bookings");
    expect(second.booking.id).not.toBe(first.booking.id);
    expect(getStore().getBooking(first.booking.id)!.status).toBe("cancelled");
    expect(piStatus[first.stripe.paymentIntentId]).toBe("canceled");
    expect(getStore().bookings.filter((x) => x.status === "draft")).toHaveLength(1);
  });

  it("discard (Change details) cancels the PI and the draft can no longer be authorized", async () => {
    useRealishStripe();
    const res = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST });
    if (!("booking" in res)) throw new Error(res.message);
    expect(await discardDraftBooking(res.booking.id)).toEqual({ discarded: true, status: "cancelled" });
    expect(cancelSpy).toHaveBeenCalledWith(res.stripe.paymentIntentId);
    piStatus[res.stripe.paymentIntentId] = "requires_capture"; // even if Stripe raced
    expect(await authorizeBooking(res.booking.id)).toMatchObject({ status: 409 });
    expect(sent).toEqual([]);
    // Discard never touches a real request.
    const real = await createBookingRequest({ spaceId: IDS.m2, ...SLOT, guest: GUEST });
    if (!("booking" in real)) throw new Error(real.message);
    piStatus[real.stripe.paymentIntentId] = "requires_capture";
    await authorizeBooking(real.booking.id);
    expect(await discardDraftBooking(real.booking.id)).toMatchObject({ discarded: false, status: "requested" });
  });

  it("abandoned drafts expire after the TTL with their PI cancelled and no emails", async () => {
    useRealishStripe();
    const res = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST });
    if (!("booking" in res)) throw new Error(res.message);
    const fresh = await expireOverdueRequests();
    expect(fresh.expiredDraftIds).toEqual([]);
    getStore().updateBooking(res.booking.id, {
      createdAt: new Date(Date.now() - (DRAFT_TTL_MINUTES + 1) * 60 * 1000).toISOString(),
    });
    const later = await expireOverdueRequests();
    expect(later.expiredDraftIds).toEqual([res.booking.id]);
    expect(getStore().getBooking(res.booking.id)!.status).toBe("expired");
    expect(piStatus[res.stripe.paymentIntentId]).toBe("canceled");
    expect(sent).toEqual([]);
  });

  it("if someone else's request took the slot first, authorizing releases this hold", async () => {
    useRealishStripe();
    const mine = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST });
    const theirs = await createBookingRequest({
      spaceId: IDS.m1,
      ...SLOT,
      guest: { name: "Grace Hopper", email: "grace@example.com" },
    });
    if (!("booking" in mine) || !("booking" in theirs)) throw new Error("expected bookings");
    piStatus[theirs.stripe.paymentIntentId] = "requires_capture";
    piStatus[mine.stripe.paymentIntentId] = "requires_capture";
    expect(await authorizeBooking(theirs.booking.id)).toMatchObject({ alreadyAuthorized: false });
    expect(await authorizeBooking(mine.booking.id)).toMatchObject({ error: "slot_unavailable" });
    expect(piStatus[mine.stripe.paymentIntentId]).toBe("canceled");
    expect(sent.filter((m) => m.to === GUEST.email)).toEqual([]);
  });
});

describe("demo mode (no Stripe keys)", () => {
  it("a mock hold has no card step, so it is authorized and notified immediately", async () => {
    const res = await createBookingRequest({ spaceId: IDS.m1, ...SLOT, guest: GUEST });
    if (!("booking" in res)) throw new Error(res.message);
    expect(res.booking.status).toBe("requested");
    expect(sent.map((m) => m.template).sort()).toEqual(["booking_requested", "host_new_request"]);
  });
});

describe("room page", () => {
  const src = readFileSync(join(process.cwd(), "app/spaces/[slug]/page.tsx"), "utf8");
  it("has no blur/change/effect auto-submit that creates a booking", () => {
    expect(src).not.toMatch(/handleEmailBlur/);
    expect(src).not.toMatch(/onBlur=\{[^}]*createHold/);
    // createHold is only wired to the explicit button click.
    const callers = src.match(/(?<!function )createHold\(/g) ?? [];
    expect(callers.length).toBe(1);
    expect(src).toMatch(/onClick=\{\(e\) => void createHold\(e\)\}/);
  });
  it("sends a per-attempt idempotency key and confirms authorization with the server", () => {
    expect(src).toMatch(/clientRequestKey: requestKeyRef\.current/);
    expect(src).toMatch(/\/authorize`/);
  });
});
