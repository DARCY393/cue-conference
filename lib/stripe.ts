import Stripe from "stripe";

let stripe: Stripe | null = null;

function trimmedEnv(name: string): string {
  return (process.env[name] || "").trim();
}

/** Test-mode-only: true only for a real-looking sk_test_… secret key. Live keys never count. */
export function hasStripe(): boolean {
  const key = trimmedEnv("STRIPE_SECRET_KEY");
  if (!key) return false;
  // Treat .env.example placeholders as unset
  if (key.includes("...") || key.endsWith("_here") || key === "sk_test_") return false;
  return key.startsWith("sk_test_");
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

export function getStripe(): Stripe | null {
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
  customerEmail?: string;
}): Promise<{ paymentIntentId: string; clientSecret: string; captureMethod: "manual" }> {
  const client = getStripe();
  if (!client) {
    const id = `pi_mock_${Date.now()}`;
    return {
      paymentIntentId: id,
      clientSecret: `${id}_secret_mock`,
      captureMethod: "manual",
    };
  }

  try {
    const pi = await client.paymentIntents.create({
      amount: opts.amountCents,
      currency: opts.currency,
      capture_method: "manual",
      setup_future_usage: "off_session",
      metadata: opts.metadata,
      receipt_email: opts.customerEmail,
      automatic_payment_methods: { enabled: true },
    });
    return {
      paymentIntentId: pi.id,
      clientSecret: pi.client_secret!,
      captureMethod: "manual",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    throw new Error(
      `Stripe PaymentIntent failed: ${msg}. Check STRIPE_SECRET_KEY (use a real sk_test_… or leave it blank for demo).`
    );
  }
}

export async function capturePaymentIntent(paymentIntentId: string) {
  const client = getStripe();
  if (!client) return { id: paymentIntentId, status: "succeeded" };
  return client.paymentIntents.capture(paymentIntentId);
}

export async function cancelPaymentIntent(paymentIntentId: string) {
  const client = getStripe();
  if (!client) return { id: paymentIntentId, status: "canceled" };
  return client.paymentIntents.cancel(paymentIntentId);
}

export async function createRefund(opts: {
  paymentIntentId: string;
  amountCents: number;
}) {
  const client = getStripe();
  if (!client) {
    return { id: `re_mock_${Date.now()}`, amount: opts.amountCents };
  }
  return client.refunds.create({
    payment_intent: opts.paymentIntentId,
    amount: opts.amountCents,
  });
}

export async function createOvertimePaymentIntent(opts: {
  amountCents: number;
  currency: string;
  customerId?: string;
  metadata: Record<string, string>;
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
  const pi = await client.paymentIntents.create({
    amount: opts.amountCents,
    currency: opts.currency,
    customer: opts.customerId,
    off_session: true,
    confirm: true,
    metadata: opts.metadata,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  return {
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret ?? undefined,
    status: (pi.status === "succeeded" ? "succeeded" : "requires_action") as
      | "succeeded"
      | "requires_action",
    amountCents: opts.amountCents,
  };
}
