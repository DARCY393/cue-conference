import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { method: string; params: Record<string, unknown>; opts?: Record<string, unknown> }[] = [];
const ctorKeys: string[] = [];

vi.mock("stripe", () => ({
  default: class {
    constructor(key: string) {
      ctorKeys.push(key.slice(0, 13));
    }
    paymentIntents = {
      create: async (params: Record<string, unknown>, opts?: Record<string, unknown>) => {
        calls.push({ method: "pi.create", params, opts });
        return { id: "pi_c_1", client_secret: "pi_c_1_secret_x", status: "succeeded" };
      },
      capture: async (id: string, params: Record<string, unknown>, opts?: Record<string, unknown>) => {
        calls.push({ method: "pi.capture", params: { id, ...params }, opts });
        return { id, status: "succeeded" };
      },
      cancel: async (id: string, params: Record<string, unknown>, opts?: Record<string, unknown>) => {
        calls.push({ method: "pi.cancel", params: { id, ...params }, opts });
        return { id, status: "canceled" };
      },
    };
    refunds = {
      create: async (params: Record<string, unknown>, opts?: Record<string, unknown>) => {
        calls.push({ method: "refund.create", params, opts });
        return { id: "re_1", amount: params.amount };
      },
    };
  },
}));

import {
  applicationFeeBps,
  applicationFeeFor,
  computeApplicationFeeCents,
  getConnectConfig,
  isConnectEnabled,
} from "../lib/stripe-connect";

const KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PLATFORM_SECRET_KEY",
  "STRIPE_CONNECTED_ACCOUNT_ID",
  "APPLICATION_FEE_BPS",
  "APPLICATION_FEE_ROOM_ONLY",
  "ALLOW_STRIPE_LIVE",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  calls.length = 0;
  vi.resetModules();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function enableConnect(extra: Record<string, string> = {}) {
  process.env.STRIPE_PLATFORM_SECRET_KEY = "sk_test_platform_unit";
  process.env.STRIPE_CONNECTED_ACCOUNT_ID = "acct_TESTSPP123";
  Object.assign(process.env, extra);
}

describe("connect config", () => {
  it("is OFF unless both platform key and connected account are set", () => {
    expect(isConnectEnabled()).toBe(false);
    process.env.STRIPE_PLATFORM_SECRET_KEY = "sk_test_x";
    expect(isConnectEnabled()).toBe(false);
    process.env.STRIPE_CONNECTED_ACCOUNT_ID = "acct_ABC";
    expect(isConnectEnabled()).toBe(true);
  });

  it("refuses a live platform key without ALLOW_STRIPE_LIVE", () => {
    enableConnect({ STRIPE_PLATFORM_SECRET_KEY: "sk_live_nope" });
    expect(() => getConnectConfig()).toThrow(/Refusing/);
  });

  it("rejects a malformed account id", () => {
    enableConnect({ STRIPE_CONNECTED_ACCOUNT_ID: "SPP" });
    expect(() => getConnectConfig()).toThrow(/acct_/);
  });

  it("fee rate defaults to 1000 bps and accepts overrides; invalid falls back", () => {
    expect(applicationFeeBps()).toBe(1000);
    process.env.APPLICATION_FEE_BPS = "1250";
    expect(applicationFeeBps()).toBe(1250);
    process.env.APPLICATION_FEE_BPS = "abc";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(applicationFeeBps()).toBe(1000);
  });

  it("rounds 10% of the amount", () => {
    expect(computeApplicationFeeCents(7000, 1000)).toBe(700);
    expect(computeApplicationFeeCents(12345, 1000)).toBe(1235);
    expect(computeApplicationFeeCents(5, 1000)).toBe(1);
    expect(computeApplicationFeeCents(0, 1000)).toBe(0);
  });

  it("fee includes parking by default; room-only option uses the room portion", () => {
    enableConnect();
    expect(applicationFeeFor(getConnectConfig()!, 9000, 7000)).toBe(900);
    process.env.APPLICATION_FEE_ROOM_ONLY = "true";
    expect(applicationFeeFor(getConnectConfig()!, 9000, 7000)).toBe(700);
  });
});

describe("stripe calls with Connect on", () => {
  it("booking PI is a direct charge on the connected account with a 10% fee and the tags", async () => {
    enableConnect({ STRIPE_SECRET_KEY: "rk_test_spp_unit" });
    const { createManualCapturePaymentIntent } = await import("../lib/stripe");
    const res = await createManualCapturePaymentIntent({
      amountCents: 9000,
      currency: "usd",
      metadata: { business: "cue_arts_district_conference_room" },
      description: "Cue Arts District Conference Room – M1 Meeting Room – booking b1",
      roomCents: 7000,
    });
    const c = calls[0];
    expect(c.params).toMatchObject({
      amount: 9000,
      capture_method: "manual",
      application_fee_amount: 900,
      statement_descriptor_suffix: "CUE ARTS DIST",
      description: "Cue Arts District Conference Room – M1 Meeting Room – booking b1",
    });
    expect(c.opts).toEqual({ stripeAccount: "acct_TESTSPP123" });
    expect(res).toMatchObject({ applicationFeeCents: 900, stripeAccount: "acct_TESTSPP123" });
    expect(ctorKeys.at(-1)).toBe("sk_test_platf"); // platform key, not the SPP key
  });

  it("capture, cancel and refund go to the connected account; refund returns the fee", async () => {
    enableConnect();
    const lib = await import("../lib/stripe");
    await lib.capturePaymentIntent("pi_1");
    await lib.cancelPaymentIntent("pi_2");
    await lib.createRefund({ paymentIntentId: "pi_1", amountCents: 500 });
    for (const c of calls) expect(c.opts).toEqual({ stripeAccount: "acct_TESTSPP123" });
    expect(calls[2].params).toMatchObject({ refund_application_fee: true, amount: 500 });
  });

  it("overtime PI carries a fee on the full amount", async () => {
    enableConnect({ APPLICATION_FEE_ROOM_ONLY: "true" });
    const { createOvertimePaymentIntent } = await import("../lib/stripe");
    await createOvertimePaymentIntent({ amountCents: 5250, currency: "usd", metadata: {} });
    expect(calls[0].params).toMatchObject({ off_session: true, application_fee_amount: 525 });
    expect(calls[0].opts).toEqual({ stripeAccount: "acct_TESTSPP123" });
  });
});

describe("stripe calls with Connect off (unchanged behavior)", () => {
  it("no fee, no Stripe-Account header, no refund_application_fee", async () => {
    process.env.STRIPE_SECRET_KEY = "rk_test_spp_unit";
    const lib = await import("../lib/stripe");
    await lib.createManualCapturePaymentIntent({ amountCents: 7000, currency: "usd", metadata: {} });
    await lib.createRefund({ paymentIntentId: "pi_1", amountCents: 100 });
    expect(calls[0].params).not.toHaveProperty("application_fee_amount");
    expect(calls[0].opts).toBeUndefined();
    expect(calls[1].params).not.toHaveProperty("refund_application_fee");
    expect(calls[1].opts).toBeUndefined();
  });
});
