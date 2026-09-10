import { NextRequest } from "next/server";
import { getStripe, hasStripe } from "@/lib/stripe";
import { jsonError, jsonOk } from "@/lib/http";
import { getStore, isDemoMode } from "@/lib/store";
import { query } from "@/lib/db";
import { randomUUID } from "crypto";

type LooseEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();

  let event: LooseEvent;

  if (hasStripe() && process.env.STRIPE_WEBHOOK_SECRET) {
    if (!signature) {
      return jsonError(400, "bad_request", "Missing Stripe-Signature");
    }
    try {
      const stripe = getStripe()!;
      const constructed = stripe.webhooks.constructEvent(
        raw,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      event = {
        id: constructed.id,
        type: constructed.type,
        data: {
          object: constructed.data.object as unknown as Record<string, unknown>,
        },
      };
    } catch (e) {
      return jsonError(
        400,
        "bad_request",
        e instanceof Error ? e.message : "Invalid signature"
      );
    }
  } else {
    try {
      event = JSON.parse(raw) as LooseEvent;
    } catch {
      return jsonError(400, "bad_request", "Invalid JSON");
    }
  }

  const obj = event.data?.object ?? {};
  const piId = String(obj.id ?? "");
  const amount = Number(obj.amount ?? obj.amount_received ?? 0);
  const bookingId =
    (obj.metadata as Record<string, string> | undefined)?.bookingId ||
    undefined;

  const typeMap: Record<string, string> = {
    "payment_intent.amount_capturable_updated": "authorize",
    "payment_intent.succeeded": "capture",
    "payment_intent.canceled": "cancel_hold",
    "charge.refunded": "refund",
  };
  const paymentType = typeMap[event.type];

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
      await query(
        `INSERT INTO payment_events (booking_id, type, amount_cents, stripe_object_id, idempotency_key, raw_json)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [bookingId, paymentType, amount, piId, idempotencyKey, raw]
      );
    }
  }

  return jsonOk({ received: true });
}
