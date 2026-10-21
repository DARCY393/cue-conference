import { NextRequest } from "next/server";
import { getStripe, hasStripe } from "@/lib/stripe";
import { getConnectConfig } from "@/lib/stripe-connect";
import { authorizeBooking } from "@/lib/bookings";
import { jsonError, jsonOk } from "@/lib/http";
import { getStore, isDemoMode } from "@/lib/store";
import { query } from "@/lib/db";
import { randomUUID } from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LooseEvent = {
  id: string;
  type: string;
  /** Set on Connect events (the connected account the object lives on). */
  account?: string;
  data: { object: Record<string, unknown> };
};

/**
 * Signing secrets to try: the account endpoint (STRIPE_WEBHOOK_SECRET) and, with Stripe Connect,
 * the platform's Connect endpoint (STRIPE_CONNECT_WEBHOOK_SECRET), which receives the connected
 * account's events with an `account` field.
 */
function webhookSecrets(): { secret: string; connect: boolean }[] {
  return [
    { secret: (process.env.STRIPE_WEBHOOK_SECRET || "").trim(), connect: false },
    { secret: (process.env.STRIPE_CONNECT_WEBHOOK_SECRET || "").trim(), connect: true },
  ].filter((s) => s.secret);
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();

  let event: LooseEvent;
  let viaConnectEndpoint = false;

  const secrets = webhookSecrets();
  if (hasStripe() && secrets.length > 0) {
    if (!signature) {
      return jsonError(400, "bad_request", "Missing Stripe-Signature");
    }
    const stripe = getStripe()!;
    let constructed: ReturnType<typeof stripe.webhooks.constructEvent> | null = null;
    let lastError = "Invalid signature";
    for (const { secret, connect } of secrets) {
      try {
        constructed = stripe.webhooks.constructEvent(raw, signature, secret);
        viaConnectEndpoint = connect;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Invalid signature";
      }
    }
    if (!constructed) {
      return jsonError(400, "bad_request", lastError);
    }
    event = {
      id: constructed.id,
      type: constructed.type,
      account: constructed.account ?? undefined,
      data: {
        object: constructed.data.object as unknown as Record<string, unknown>,
      },
    };
  } else {
    try {
      event = JSON.parse(raw) as LooseEvent;
    } catch {
      return jsonError(400, "bad_request", "Invalid JSON");
    }
  }

  // Connect endpoint: only the SPP/Cue connected account's events count; other accounts on the
  // platform and platform-level events (no account) are acknowledged and ignored. Events on the
  // SPP account's own endpoint (STRIPE_WEBHOOK_SECRET) carry no account field and are accepted.
  const connect = getConnectConfig();
  if (viaConnectEndpoint && (!connect || event.account !== connect.connectedAccountId)) {
    return jsonOk({ received: true, ignored: "other_account" });
  }

  const obj = event.data?.object ?? {};
  const piId = String(obj.id ?? "");
  const amount = Number(obj.amount ?? obj.amount_received ?? 0);
  const bookingId =
    (obj.metadata as Record<string, string> | undefined)?.bookingId ||
    (obj.metadata as Record<string, string> | undefined)?.booking_id ||
    undefined;

  const typeMap: Record<string, string> = {
    "payment_intent.amount_capturable_updated": "authorize",
    "payment_intent.succeeded": "capture",
    "payment_intent.canceled": "cancel_hold",
    "charge.refunded": "refund",
  };
  const paymentType = typeMap[event.type];

  // Card hold authorized: promote the draft to a request (idempotent; also triggered by the
  // guest's browser). This covers a guest who closes the tab right after confirming.
  if (event.type === "payment_intent.amount_capturable_updated" && bookingId) {
    try {
      await authorizeBooking(bookingId);
    } catch (e) {
      console.error("[webhook] authorizeBooking failed", bookingId, e instanceof Error ? e.message : e);
    }
  }

  if (paymentType) {
    const idempotencyKey = event.id;
    if (isDemoMode()) {
      const exists = getStore().paymentEvents.some(
        (e) => e.idempotencyKey === idempotencyKey
      );
      if (!exists) {
        getStore().paymentEvents.push({
          id: randomUUID(),
          bookingId: bookingId || "unknown",
          type: paymentType,
          amountCents: amount,
          stripeObjectId: piId,
          idempotencyKey,
        });
      }
    } else if (bookingId) {
      // The SPP account's endpoint also receives events for PIs made by other deployments on the
      // same Stripe account (e.g. the preview). Record only bookings that exist in THIS database and
      // acknowledge the rest with 200, so Stripe doesn't retry them (and eventually disable us).
      if (!UUID_RE.test(bookingId)) return jsonOk({ received: true, ignored: "unknown_booking" });
      const { rowCount } = await query(
        `INSERT INTO payment_events (booking_id, type, amount_cents, stripe_object_id, idempotency_key, raw_json)
         SELECT $1::uuid, $2::payment_event_type, $3::integer, $4::text, $5::text, $6::jsonb
         WHERE EXISTS (SELECT 1 FROM bookings WHERE id = $1::uuid)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [bookingId, paymentType, amount, piId, idempotencyKey, raw]
      );
      if (!rowCount) {
        const known = await query(`SELECT 1 FROM bookings WHERE id = $1::uuid`, [bookingId]);
        if (!known.rows.length) return jsonOk({ received: true, ignored: "unknown_booking" });
      }
    }
  }

  return jsonOk({ received: true });
}
