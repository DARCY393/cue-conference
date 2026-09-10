"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { Quote, SpacePublic } from "@/lib/types";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

function isMockSecret(secret: string) {
  return secret.includes("_secret_mock");
}

function PaymentConfirmPanel({
  onSuccess,
  onError,
}: {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setConfirming(true);
    onError("");
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });
      if (error) {
        onError(error.message || "Payment confirmation failed");
        return;
      }
      const status = paymentIntent?.status ?? "unknown";
      if (
        status === "requires_capture" ||
        status === "succeeded" ||
        status === "processing"
      ) {
        onSuccess(
          status === "requires_capture"
            ? "Card authorized. Host accept will capture the hold."
            : `Payment ${status}.`
        );
      } else {
        onError(`Unexpected payment status: ${status}`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Payment confirmation failed");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      <button
        type="button"
        onClick={() => void handleConfirm()}
        disabled={!stripe || !elements || confirming}
        className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {confirming ? "Confirming…" : "Confirm payment"}
      </button>
    </div>
  );
}

export default function CueDallasPage() {
  const [space, setSpace] = useState<SpacePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [parking, setParking] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    bookingId: string;
    clientSecret: string;
  } | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/spaces/cue-dallas")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message || "Failed to load");
        return r.json();
      })
      .then(setSpace)
      .catch((e) => setError(e.message));
  }, []);

  const windowIso = useMemo(() => {
    if (!date || !space) return null;
    // Build local Chicago wall times as ISO by appending offset approximation via Date parsing as local —
    // For MVP UI we send as America/Chicago wall clock with -06:00/-05:00 naive: use Date constructed and toISOString.
    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }, [date, startTime, endTime, space]);

  const refreshQuote = useCallback(async () => {
    if (!space || !windowIso) return;
    setQuoteError(null);
    const addons = parking
      ? [{ addonId: space.addons[0]?.id, quantity: 1 }]
      : [];
    const res = await fetch(`/api/v1/spaces/${space.id}/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startsAt: windowIso.startsAt,
        endsAt: windowIso.endsAt,
        addons: addons.filter((a) => a.addonId),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setQuote(null);
      setQuoteError(data.message || data.error);
      return;
    }
    setQuote(data);
  }, [space, windowIso, parking]);

  useEffect(() => {
    if (windowIso && space) void refreshQuote();
  }, [windowIso, space, parking, refreshQuote]);

  async function submitBooking(e: FormEvent) {
    e.preventDefault();
    if (!space || !windowIso) return;
    setSubmitting(true);
    setError(null);
    setPaymentMessage(null);
    setPaymentError(null);
    try {
      const addons = parking
        ? [{ addonId: space.addons[0]?.id, quantity: 1 }]
        : [];
      const res = await fetch("/api/v1/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId: space.id,
          startsAt: windowIso.startsAt,
          endsAt: windowIso.endsAt,
          addons: addons.filter((a) => a.addonId),
          guestNotes: notes,
          guest: { name: guestName, email: guestEmail, phone: guestPhone || undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Booking failed");
      setResult({
        bookingId: data.booking.id,
        clientSecret: data.stripe.clientSecret,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !space) {
    return <p className="text-red-600">{error}</p>;
  }
  if (!space) {
    return <p className="text-slate-500">Loading Cue…</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <section className="lg:col-span-3 space-y-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={space.photos[0]?.url}
            alt={space.photos[0]?.alt || space.title}
            className="h-56 w-full object-cover"
          />
          <div className="space-y-3 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">{space.title}</h1>
                <p className="text-slate-600">{space.subtitle}</p>
              </div>
              <div className="rounded-xl bg-blue-50 px-3 py-2 text-right">
                <div className="text-lg font-semibold text-blue-700">
                  {money(space.pricing.baseHourlyCents)}
                </div>
                <div className="text-xs text-blue-600">per hour</div>
              </div>
            </div>
            <p className="text-sm text-slate-600">{space.description}</p>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {space.city} · {space.neighborhood}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Capacity {space.capacity}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Mon–Fri 7:00–18:00 ({space.timezone})
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Request to book
              </span>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium text-slate-800">Amenities</h2>
              <ul className="flex flex-wrap gap-2">
                {space.amenities.map((a) => (
                  <li
                    key={a.key}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                  >
                    {a.label}
                  </li>
                ))}
              </ul>
            </div>
            {space.hostRulesMd && (
              <div>
                <h2 className="mb-2 text-sm font-medium text-slate-800">House rules</h2>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  {space.hostRulesMd.trim()}
                </pre>
              </div>
            )}
            {space.cancellationPolicy && (
              <p className="text-xs text-slate-500">
                Cancellation: <strong>{space.cancellationPolicy.name}</strong> — full
                refund ≥7 days before; 50% ≥24h before; grace within 24h of confirm if
                start ≥48h away.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="lg:col-span-2">
        <form
          onSubmit={submitBooking}
          className="sticky top-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-lg font-semibold">Request a booking</h2>
          <label className="block text-sm">
            <span className="text-slate-600">Date</span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">Start</span>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">End</span>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
          </div>
          {space.addons[0] && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={parking}
                onChange={(e) => setParking(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{space.addons[0].name}</span>
                <span className="block text-xs text-slate-500">
                  {money(space.addons[0].priceCents)}/day
                </span>
              </span>
            </label>
          )}
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            {quoteError && <p className="text-red-600">{quoteError}</p>}
            {quote && (
              <ul className="space-y-1">
                {quote.lineItems.map((li) => (
                  <li key={li.code} className="flex justify-between text-slate-700">
                    <span>{li.label}</span>
                    <span>{money(li.amountCents)}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
                  <span>Total</span>
                  <span>{money(quote.totalCents)}</span>
                </li>
              </ul>
            )}
            {!quote && !quoteError && (
              <p className="text-slate-500">Select a date to see pricing</p>
            )}
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">Your name</span>
            <input
              required
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Email</span>
            <input
              type="email"
              required
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Phone (optional)</span>
            <input
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <p className="font-medium">Request created</p>
                <p className="mt-1 break-all">Booking: {result.bookingId}</p>
                <p className="mt-2 text-xs">
                  Payment uses manual capture — host accept will capture the hold.
                </p>
              </div>

              {isMockSecret(result.clientSecret) ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Demo mode</p>
                  <p className="mt-1 text-xs">
                    Stripe keys are unset, so this booking used a mock PaymentIntent.
                    Set <code className="font-mono">STRIPE_SECRET_KEY</code> and{" "}
                    <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>{" "}
                    for real test-mode card collection.
                  </p>
                  <p className="mt-1 break-all text-xs opacity-70">
                    {result.clientSecret}
                  </p>
                </div>
              ) : !stripePromise || !publishableKey ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  Booking created, but{" "}
                  <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>{" "}
                  is missing — cannot load Stripe Payment Element.
                </div>
              ) : paymentMessage ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <p className="font-medium">Payment confirmed</p>
                  <p className="mt-1">{paymentMessage}</p>
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-800">
                    Enter payment details
                  </p>
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: result.clientSecret,
                      appearance: { theme: "stripe" },
                    }}
                  >
                    <PaymentConfirmPanel
                      onSuccess={(msg) => {
                        setPaymentMessage(msg);
                        setPaymentError(null);
                      }}
                      onError={(msg) => {
                        setPaymentError(msg || null);
                      }}
                    />
                  </Elements>
                  {paymentError && (
                    <p className="text-sm text-red-600">{paymentError}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              type="submit"
              disabled={submitting || !quote}
              className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Request to book"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
