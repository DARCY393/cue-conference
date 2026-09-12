import Stripe from "stripe";

let stripe: Stripe | null = null;

export function hasStripe(): boolean {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return false;
  // Treat .env.example placeholders as unset
  if (key.includes("...") || key.endsWith("_here") || key === "sk_test_") return false;
  return key.startsWith("sk_test_") || key.startsWith("sk_live_");
}

export function getStripe(): Stripe | null {
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
