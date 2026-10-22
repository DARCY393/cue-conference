import Stripe from "stripe";
import { STATEMENT_DESCRIPTOR_SUFFIX } from "./stripe-tags";
import { applicationFeeFor, getConnectConfig } from "./stripe-connect";

let stripe: Stripe | null = null;
let platformStripe: Stripe | null = null;

function trimmedEnv(name: string): string {
  return (process.env[name] || "").trim();
}

/** Test-mode-only: true only for a real-looking sk_test_… or restricted rk_test_… key. Live keys never count. */
export function hasStripe(): boolean {
  if (getConnectConfig()) return true;
  const key = trimmedEnv("STRIPE_SECRET_KEY");
  if (!key) return false;
  // Treat .env.example placeholders as unset
  if (key.includes("...") || key.endsWith("_here") || key === "sk_test_") return false;
  return key.startsWith("sk_test_") || key.startsWith("rk_test_");
}

function isLiveKeyConfigured(): boolean {
  const secret = trimmedEnv("STRIPE_SECRET_KEY");
  const publishable = trimmedEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  return (
    secret.startsWith("sk_live_") ||
    secret.startsWith("rk_live_") ||
    publishable.startsWith("pk_live_")
  );
}

/**
 * This app is test-mode only by default. ALLOW_STRIPE_LIVE must only be set to "true"
 * in the environment after D'Arcy has explicitly approved going live.
 */
function assertLiveModeAllowed(): void {
  if (!isLiveKeyConfigured()) return;
  if (process.env.ALLOW_STRIPE_LIVE === "true") {
    console.error(
      "[stripe] ALLOW_STRIPE_LIVE=true — proceeding with LIVE Stripe keys. " +
        "This flag must only be set after D'Arcy has approved going live."
    );
    return;
  }
  console.error(
    "[stripe] Refusing to use LIVE Stripe keys (sk_live_/rk_live_/pk_live_ detected). " +
      "This app is test-mode only by default. Set ALLOW_STRIPE_LIVE=true only after D'Arcy approves going live."
  );
  throw new Error(
    "Live Stripe keys detected but ALLOW_STRIPE_LIVE is not set to 'true'. Refusing to create a live Stripe PaymentIntent."
  );
}

/**
 * Per-request options. With Connect on, every call goes to the connected (SPP/Cue) account via the
 * Stripe-Account header using the platform (Honeycomb) key. Otherwise undefined (single account).
 */
export function stripeRequestOptions(): Stripe.RequestOptions | undefined {
  const cfg = getConnectConfig();
  return cfg ? { stripeAccount: cfg.connectedAccountId } : undefined;
}

export function getStripe(): Stripe | null {
  const connect = getConnectConfig();
  if (connect) {
    assertLiveModeAllowed(); // also refuses a pk_live_ publishable key
    if (!platformStripe) platformStripe = new Stripe(connect.platformSecretKey);
    return platformStripe;
  }
  assertLiveModeAllowed();
  if (isLiveKeyConfigured()) {
    // assertLiveModeAllowed() above already confirmed ALLOW_STRIPE_LIVE=true.
    if (!stripe) {
      stripe = new Stripe(trimmedEnv("STRIPE_SECRET_KEY"));
    }
    return stripe;
  }
  if (!hasStripe()) return null;
  if (!stripe) {
    // Use account/SDK default API version
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripe;
}

export async function createManualCapturePaymentIntent(opts: {
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  /** "Cue Arts District Conference Room – <room> – booking <id>" (see lib/stripe-tags.ts). */
  description?: string;
  statementDescriptorSuffix?: string;
  customerEmail?: string;
  /** Room-only portion of the amount, used for the fee when APPLICATION_FEE_ROOM_ONLY=true. */
  roomCents?: number;
}): Promise<{
  paymentIntentId: string;
  clientSecret: string;
  captureMethod: "manual";
  applicationFeeCents?: number;
  stripeAccount?: string;
}> {
  const client = getStripe();
  if (!client) {
    const id = `pi_mock_${Date.now()}`;
    return {
      paymentIntentId: id,
      clientSecret: `${id}_secret_mock`,
      captureMethod: "manual",
    };
  }

  const connect = getConnectConfig();
  const fee = connect ? applicationFeeFor(connect, opts.amountCents, opts.roomCents) : undefined;
  try {
    const pi = await client.paymentIntents.create({
      amount: opts.amountCents,
      currency: opts.currency,
      capture_method: "manual",
      // Direct charge: fee is collected on capture; cancel/decline releases it with the hold.
      ...(connect && fee ? { application_fee_amount: fee } : {}),
      setup_future_usage: "off_session",
      metadata: opts.metadata,
      description: opts.description,
      statement_descriptor_suffix: opts.statementDescriptorSuffix ?? STATEMENT_DESCRIPTOR_SUFFIX,
      receipt_email: opts.customerEmail,
      automatic_payment_methods: { enabled: true },
    }, stripeRequestOptions());
    return {
      paymentIntentId: pi.id,
      clientSecret: pi.client_secret!,
      captureMethod: "manual",
      ...(connect ? { applicationFeeCents: fee ?? 0, stripeAccount: connect.connectedAccountId } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    throw new Error(
      `Stripe PaymentIntent failed: ${msg}. Check STRIPE_SECRET_KEY (use a real sk_test_… or leave it blank for demo).`
    );
  }
}

/** Current status/amount of a PaymentIntent (on the connected account when Connect is on). Mock ids count as authorized. */
export async function retrievePaymentIntent(paymentIntentId: string): Promise<{
  id: string;
  status: string;
  amountCents?: number;
  clientSecret?: string;
  mock: boolean;
}> {
  const client = getStripe();
  if (!client || paymentIntentId.includes("_mock_")) {
    return { id: paymentIntentId, status: "requires_capture", clientSecret: `${paymentIntentId}_secret_mock`, mock: true };
  }
  const pi = await client.paymentIntents.retrieve(paymentIntentId, {}, stripeRequestOptions());
  return { id: pi.id, status: pi.status, amountCents: pi.amount, clientSecret: pi.client_secret ?? undefined, mock: false };
}

export async function capturePaymentIntent(paymentIntentId: string) {
  const client = getStripe();
  if (!client) return { id: paymentIntentId, status: "succeeded" };
  return client.paymentIntents.capture(paymentIntentId, {}, stripeRequestOptions());
}

export async function cancelPaymentIntent(paymentIntentId: string, opts: { idempotencyKey?: string } = {}) {
  const client = getStripe();
  if (!client) return { id: paymentIntentId, status: "canceled" };
  const reqOpts = stripeRequestOptions();
  return client.paymentIntents.cancel(
    paymentIntentId,
    {},
    opts.idempotencyKey ? { ...(reqOpts ?? {}), idempotencyKey: opts.idempotencyKey } : reqOpts
  );
}

/**
 * Amount already refunded on a PaymentIntent's charge (0 for mock ids / no Stripe). Used before a
 * cancellation refund so a retry or a concurrent click never refunds twice.
 */
export async function getRefundedCents(paymentIntentId: string): Promise<number> {
  const client = getStripe();
  if (!client || paymentIntentId.includes("_mock_")) return 0;
  const pi = await client.paymentIntents.retrieve(
    paymentIntentId,
    { expand: ["latest_charge"] },
    stripeRequestOptions()
  );
  const charge = pi.latest_charge;
  if (charge && typeof charge === "object") return Number(charge.amount_refunded ?? 0);
  return 0;
}

export async function createRefund(opts: {
  paymentIntentId: string;
  amountCents: number;
  /** Stripe idempotency key: the same key never creates a second refund. */
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}) {
  const client = getStripe();
  if (!client) {
    return { id: `re_mock_${Date.now()}`, amount: opts.amountCents };
  }
  const connect = getConnectConfig();
  const reqOpts = stripeRequestOptions();
  return client.refunds.create(
    {
      payment_intent: opts.paymentIntentId,
      amount: opts.amountCents,
      // Direct charge: give back Honeycomb's fee pro rata with the refund.
      ...(connect ? { refund_application_fee: true } : {}),
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    },
    opts.idempotencyKey ? { ...(reqOpts ?? {}), idempotencyKey: opts.idempotencyKey } : reqOpts
  );
}

export async function createOvertimePaymentIntent(opts: {
  amountCents: number;
  currency: string;
  customerId?: string;
  metadata: Record<string, string>;
  description?: string;
  statementDescriptorSuffix?: string;
}) {
  const client = getStripe();
  if (!client) {
    const id = `pi_ot_mock_${Date.now()}`;
    return {
      paymentIntentId: id,
      clientSecret: undefined as string | undefined,
      status: "succeeded" as const,
      amountCents: opts.amountCents,
    };
  }
  const connect = getConnectConfig();
  // Overtime/damage is room time, so the fee is on the full amount either way.
  const fee = connect ? applicationFeeFor(connect, opts.amountCents) : 0;
  const pi = await client.paymentIntents.create({
    amount: opts.amountCents,
    currency: opts.currency,
    customer: opts.customerId,
    ...(connect && fee ? { application_fee_amount: fee } : {}),
    off_session: true,
    confirm: true,
    metadata: opts.metadata,
    description: opts.description,
    statement_descriptor_suffix: opts.statementDescriptorSuffix ?? STATEMENT_DESCRIPTOR_SUFFIX,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  }, stripeRequestOptions());
  return {
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret ?? undefined,
    status: (pi.status === "succeeded" ? "succeeded" : "requires_action") as
      | "succeeded"
      | "requires_action",
    amountCents: opts.amountCents,
  };
}
