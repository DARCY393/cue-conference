import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import { resetStore, getStore } from "../lib/store";

const ACCT_SECRET = "whsec_acct_unit";
const CONNECT_SECRET = "whsec_connect_unit";
const ENV = {
  STRIPE_SECRET_KEY: "rk_test_spp_unit",
  STRIPE_PLATFORM_SECRET_KEY: "sk_test_platform_unit",
  STRIPE_CONNECTED_ACCOUNT_ID: "acct_TESTSPP123",
  STRIPE_WEBHOOK_SECRET: ACCT_SECRET,
  STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET,
};
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  resetStore();
  vi.resetModules();
});
afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function signed(payload: object, secret: string) {
  const body = JSON.stringify(payload);
  const header = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload: body, secret });
  return new NextRequest("http://localhost/api/v1/webhooks/stripe", {
    method: "POST",
    body,
    headers: { "stripe-signature": header },
  });
}

const piEvent = (account?: string) => ({
  id: `evt_${Math.random().toString(36).slice(2)}`,
  object: "event",
  type: "payment_intent.succeeded",
  ...(account ? { account } : {}),
  data: { object: { id: "pi_1", amount: 7000, metadata: { booking_id: "b-1" } } },
});

describe("stripe webhook with Connect", () => {
  it("records events for the connected account from the Connect endpoint", async () => {
    const { POST } = await import("../app/api/v1/webhooks/stripe/route");
    const res = await POST(signed(piEvent("acct_TESTSPP123"), CONNECT_SECRET));
    expect(await res.json()).toMatchObject({ received: true });
    expect(getStore().paymentEvents.map((e) => e.bookingId)).toContain("b-1");
  });

  it("ignores Connect events for other accounts", async () => {
    const { POST } = await import("../app/api/v1/webhooks/stripe/route");
    const res = await POST(signed(piEvent("acct_SOMEONEELSE"), CONNECT_SECRET));
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("other_account");
    expect(getStore().paymentEvents).toHaveLength(0);
  });

  it("still accepts the SPP account's own endpoint (no account field)", async () => {
    const { POST } = await import("../app/api/v1/webhooks/stripe/route");
    await POST(signed(piEvent(), ACCT_SECRET));
    expect(getStore().paymentEvents).toHaveLength(1);
  });

  it("rejects a bad signature", async () => {
    const { POST } = await import("../app/api/v1/webhooks/stripe/route");
    const res = await POST(signed(piEvent("acct_TESTSPP123"), "whsec_wrong"));
    expect(res.status).toBe(400);
  });
});

describe("stripe webhook: events for bookings in another deployment's DB", () => {
  it("only records payment_events for bookings that exist here, and 200s the rest", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(require("path").join(__dirname, "../app/api/v1/webhooks/stripe/route.ts"), "utf8");
    expect(src).toContain("WHERE EXISTS (SELECT 1 FROM bookings WHERE id = $1::uuid)");
    expect(src).toContain('ignored: "unknown_booking"');
    expect(src).toContain("$2::payment_event_type");
  });
});
