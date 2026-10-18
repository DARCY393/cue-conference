import { randomUUID } from "crypto";
import { calculateQuote, calculateOvertimeCents, computeAddonCents } from "./quote";
import { calculateFlexibleRefund, FLEXIBLE_DEFAULT } from "./refund";
import { isAvailable, withinBookableHours } from "./availability";
import { getBusy, getSpaceById } from "./space-service";
import { getStore, isDemoMode } from "./store";
import { query } from "./db";
import {
  createManualCapturePaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  createRefund,
  createOvertimePaymentIntent,
} from "./stripe";
import { getEmailSender } from "./email";
import { getGoogleBusy, createGoogleBookingEvent, deleteGoogleBookingEvent } from "./google-calendar";
import type { Booking, QuoteAddonInput, SpacePublic } from "./types";
import { IDS } from "./seed";

const HOST_ACTION_HOURS = 24;

function toBookingPublic(b: Booking, space?: SpacePublic | null): Booking {
  const out = { ...b };
  if (space) {
    out.spaceTitle = space.title;
    out.spaceShortTitle = space.shortTitle;
    out.locationName = space.location?.name;
    out.spaceSlug = space.slug;
  }
  if (
    space?.addressPrivate &&
    ["accepted", "in_progress", "completed"].includes(b.status)
  ) {
    out.accessDetails = space.addressPrivate;
  }
  return out;
}

/** Strip internal calendar-sync fields before a booking is serialized to any API response. */
export function sanitizeBookingForApi(b: Booking): Booking {
  const copy = { ...b };
  delete copy.googleEventId;
  return copy;
}

export type ApiErr = { ok: false; error: string; message: string; status: number };
export type QuoteOk = { ok: true; quote: import("./types").Quote; space: SpacePublic };

export async function createQuoteForSpace(
  spaceId: string,
  startsAt: Date,
  endsAt: Date,
  addons?: QuoteAddonInput[]
): Promise<QuoteOk | ApiErr> {
  const space = await getSpaceById(spaceId);
  if (!space) {
    return { ok: false, error: "not_found", message: "Space not found", status: 404 };
  }
  if (!withinBookableHours(startsAt, endsAt, space.timezone, space.bookableHours)) {
    return {
      ok: false,
      error: "outside_bookable_hours",
      message: "Requested time is outside Mon–Fri 7:00–18:00 local.",
      status: 409,
    };
  }
  const busy = await getBusy(spaceId, startsAt, endsAt);
  const googleBusy = await getGoogleBusy(space, startsAt, endsAt);
  if (!googleBusy.ok) {
    return {
      ok: false,
      error: googleBusy.error,
      message: googleBusy.message,
      status: 409,
    };
  }
  const available = isAvailable(startsAt, endsAt, [...busy, ...googleBusy.busy]);
  if (!available) {
    return {
      ok: false,
      error: "slot_unavailable",
      message: "That time overlaps an existing booking or blockout.",
      status: 409,
    };
  }
  try {
    const quote = calculateQuote({
      startsAt,
      endsAt,
      pricing: space.pricing,
      addonsCatalog: space.addons,
      addonSelections: addons,
      available: true,
      roomLabel: space.shortTitle,
    });
    return { ok: true, quote, space };
  } catch (e) {
    return {
      ok: false,
      error: "bad_request",
      message: e instanceof Error ? e.message : "Invalid quote request",
      status: 400,
    };
  }
}

export type CreateBookingResult =
  | { error: string; message: string; status: number }
  | {
      booking: Booking;
      stripe: Awaited<ReturnType<typeof createManualCapturePaymentIntent>>;
    };

export async function createBookingRequest(body: {
  spaceId: string;
  startsAt: string;
  endsAt: string;
  addons?: (QuoteAddonInput & { meta?: Record<string, unknown> })[];
  guestNotes?: string;
  activityDescription?: string;
  guest: { name: string; email: string; phone?: string };
}): Promise<CreateBookingResult> {
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  const quoted = await createQuoteForSpace(
    body.spaceId,
    startsAt,
    endsAt,
    body.addons
  );
  if (!quoted.ok) {
    return { error: quoted.error, message: quoted.message, status: quoted.status };
  }
  const { quote, space } = quoted;

  const stripe = await createManualCapturePaymentIntent({
    amountCents: quote.totalCents,
    currency: quote.currency,
    metadata: { spaceId: body.spaceId, guestEmail: body.guest.email },
    customerEmail: body.guest.email,
  });

  const now = new Date();
  const deadline = new Date(now.getTime() + HOST_ACTION_HOURS * 60 * 60 * 1000);
  const { resolved } = computeAddonCents(
    space.addons,
    body.addons,
    startsAt,
    endsAt
  );

  if (isDemoMode()) {
    const guest = getStore().upsertGuest(
      body.guest.name,
      body.guest.email,
      body.guest.phone
    );
    const booking: Booking = {
      id: randomUUID(),
      spaceId: body.spaceId,
      guestId: guest.id,
      status: "requested",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      guestNotes: body.guestNotes,
      activityDescription: body.activityDescription,
      currency: quote.currency,
      subtotalCents: quote.baseCents,
      discountCents: quote.discountCents,
      addonsCents: quote.addonsCents,
      feesCents: quote.feesCents,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents,
      addons: resolved.map((r) => ({
        addonId: r.addon.id,
        name: r.addon.name,
        quantity: r.quantity,
        unitPriceCents: r.unitPriceCents,
        meta: r.meta,
      })),
      requestedAt: now.toISOString(),
      hostActionDeadlineAt: deadline.toISOString(),
      stripePaymentIntentId: stripe.paymentIntentId,
      createdAt: now.toISOString(),
      guestEmail: body.guest.email,
      guestName: body.guest.name,
      quoteJson: quote,
    };
    getStore().createBooking(booking);
    await getEmailSender().send({
      to: body.guest.email,
      template: "booking_requested",
      subject: `Request sent for ${space.title}`,
      payload: { bookingId: booking.id },
    });
    await getEmailSender().send({
      to: process.env.HOST_EMAIL || "host@example.com",
      template: "host_new_request",
      subject: `New booking request for ${space.title}`,
      payload: { bookingId: booking.id },
    });
    return { booking: toBookingPublic(booking, space), stripe };
  }

  // DB path (simplified MVP insert)
  // Unique index is on lower(email) — cannot use bare ON CONFLICT DO NOTHING.
  // Select-then-insert; on race, select again.
  let guestId: string | undefined;
  {
    const existing = await query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1)`,
      [body.guest.email]
    );
    guestId = existing.rows[0]?.id;
  }
  if (!guestId) {
    try {
      const inserted = await query<{ id: string }>(
        `INSERT INTO users (role, name, email, phone)
         VALUES ('guest', $1, $2, $3)
         RETURNING id`,
        [body.guest.name, body.guest.email, body.guest.phone ?? null]
      );
      guestId = inserted.rows[0]?.id;
    } catch {
      // Concurrent insert won the unique index race — re-select.
      const again = await query<{ id: string }>(
        `SELECT id FROM users WHERE lower(email) = lower($1)`,
        [body.guest.email]
      );
      guestId = again.rows[0]?.id;
    }
  }
  if (!guestId) throw new Error("Failed to upsert guest");

  const bookingId = randomUUID();
  await query(
    `INSERT INTO bookings (
      id, space_id, guest_id, status, starts_at, ends_at, guest_notes, activity_description,
      quote_json, currency, subtotal_cents, discount_cents, addons_cents, fees_cents, tax_cents, total_cents,
      cancellation_policy_id, requested_at, host_action_deadline_at, stripe_payment_intent_id
    ) VALUES (
      $1,$2,$3,'requested',$4,$5,$6,$7,$8,'usd',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
    )`,
    [
      bookingId,
      body.spaceId,
      guestId,
      startsAt.toISOString(),
      endsAt.toISOString(),
      body.guestNotes ?? null,
      body.activityDescription ?? null,
      JSON.stringify(quote),
      quote.baseCents,
      quote.discountCents,
      quote.addonsCents,
      quote.feesCents,
      quote.taxCents,
      quote.totalCents,
      IDS.policy,
      now.toISOString(),
      deadline.toISOString(),
      stripe.paymentIntentId,
    ]
  );

  for (const r of resolved) {
    await query(
      `INSERT INTO booking_addons (booking_id, addon_id, quantity, unit_price_cents, meta_json)
       VALUES ($1,$2,$3,$4,$5)`,
      [bookingId, r.addon.id, r.quantity, r.unitPriceCents, JSON.stringify(r.meta ?? {})]
    );
  }

  const booking = await getBookingById(bookingId);
  return { booking: booking!, stripe };
}

export async function getBookingById(id: string): Promise<Booking | null> {
  if (isDemoMode()) {
    const b = getStore().getBooking(id);
    if (!b) return null;
    const space = getStore().getSpaceById(b.spaceId);
    return toBookingPublic(b, space);
  }
  const { rows } = await query<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  const space = await getSpaceById(String(r.space_id));
  const booking: Booking = {
    id: String(r.id),
    spaceId: String(r.space_id),
    guestId: String(r.guest_id),
    status: r.status as Booking["status"],
    startsAt: new Date(r.starts_at as string).toISOString(),
    endsAt: new Date(r.ends_at as string).toISOString(),
    guestNotes: (r.guest_notes as string) ?? undefined,
    activityDescription: (r.activity_description as string) ?? undefined,
    currency: String(r.currency),
    subtotalCents: Number(r.subtotal_cents),
    discountCents: Number(r.discount_cents),
    addonsCents: Number(r.addons_cents),
    feesCents: Number(r.fees_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    requestedAt: r.requested_at
      ? new Date(r.requested_at as string).toISOString()
      : undefined,
    hostActionDeadlineAt: r.host_action_deadline_at
      ? new Date(r.host_action_deadline_at as string).toISOString()
      : undefined,
    decidedAt: r.decided_at
      ? new Date(r.decided_at as string).toISOString()
      : undefined,
    cancelledAt: r.cancelled_at
      ? new Date(r.cancelled_at as string).toISOString()
      : undefined,
    completedAt: r.completed_at
      ? new Date(r.completed_at as string).toISOString()
      : undefined,
    stripePaymentIntentId: (r.stripe_payment_intent_id as string) ?? undefined,
    googleEventId: (r.google_event_id as string) ?? undefined,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
  return toBookingPublic(booking, space);
}

export async function cancelBooking(
  id: string,
  reason?: string
): Promise<
  | { booking: Booking; refundCents: number; refundId?: string }
  | { error: string; message: string; status: number }
> {
  void reason;
  const booking = await getBookingById(id);
  if (!booking) return { error: "not_found", message: "Booking not found", status: 404 };
  if (booking.status !== "accepted") {
    return {
      error: "invalid_status",
      message: "Only accepted bookings can be cancelled via this endpoint",
      status: 409,
    };
  }
  const space = await getSpaceById(booking.spaceId);
  const rules = space?.cancellationPolicy?.rules ?? FLEXIBLE_DEFAULT;
  const result = calculateFlexibleRefund({
    now: new Date(),
    startsAt: new Date(booking.startsAt),
    confirmedAt: new Date(booking.decidedAt || booking.createdAt),
    totalCents: booking.totalCents,
    feesCents: booking.feesCents,
    rules,
  });

  let refundId: string | undefined;
  if (result.refundCents > 0 && booking.stripePaymentIntentId) {
    const refund = await createRefund({
      paymentIntentId: booking.stripePaymentIntentId,
      amountCents: result.refundCents,
    });
    refundId = refund.id;
  }

  const cancelledAt = new Date().toISOString();
  if (isDemoMode()) {
    getStore().updateBooking(id, { status: "cancelled", cancelledAt });
  } else {
    await query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = $2 WHERE id = $1`,
      [id, cancelledAt]
    );
  }
  if (booking.googleEventId) {
    await deleteGoogleBookingEvent(space, booking.googleEventId);
  }
  const updated = (await getBookingById(id))!;
  await getEmailSender().send({
    to: booking.guestEmail || "guest@example.com",
    template: "booking_cancelled",
    subject: "Booking cancelled",
    payload: { bookingId: id, refundCents: result.refundCents, tier: result.tier },
  });
  return { booking: updated, refundCents: result.refundCents, refundId };
}

export async function acceptBooking(id: string) {
  const booking = await getBookingById(id);
  if (!booking) return { error: "not_found" as const, message: "Booking not found", status: 404 };
  if (booking.status !== "requested") {
    return { error: "invalid_status" as const, message: "Booking is not requested", status: 409 };
  }
  const startsAt = new Date(booking.startsAt);
  const endsAt = new Date(booking.endsAt);
  const space = await getSpaceById(booking.spaceId);
  const busy = await getBusy(booking.spaceId, startsAt, endsAt);
  // exclude self
  const others = busy.filter(
    (b) =>
      !(
        b.kind === "booking" &&
        b.startsAt === booking.startsAt &&
        b.endsAt === booking.endsAt
      )
  );
  let allBusy = others;
  if (space) {
    const googleBusy = await getGoogleBusy(space, startsAt, endsAt);
    if (!googleBusy.ok) {
      return { error: googleBusy.error, message: googleBusy.message, status: 409 };
    }
    allBusy = [...others, ...googleBusy.busy];
  }
  if (!isAvailable(startsAt, endsAt, allBusy)) {
    return {
      error: "slot_unavailable" as const,
      message: "Slot conflict on re-check",
      status: 409,
    };
  }
  if (booking.stripePaymentIntentId) {
    await capturePaymentIntent(booking.stripePaymentIntentId);
  }
  const decidedAt = new Date().toISOString();
  let googleEventId: string | undefined;
  let calendarSyncWarning: string | undefined;
  if (space) {
    const eventResult = await createGoogleBookingEvent(space, {
      id: booking.id,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      guestName: booking.guestName,
    });
    if (eventResult.ok) {
      googleEventId = eventResult.eventId;
    } else {
      calendarSyncWarning = eventResult.message || "Failed to sync booking to Google Calendar";
      console.error(`[google-calendar] accept(${id}): ${calendarSyncWarning}`);
    }
  }
  if (isDemoMode()) {
    getStore().updateBooking(id, { status: "accepted", decidedAt, googleEventId });
  } else {
    await query(
      `UPDATE bookings SET status = 'accepted', decided_at = $2, google_event_id = $3 WHERE id = $1`,
      [id, decidedAt, googleEventId ?? null]
    );
  }
  const updated = (await getBookingById(id))!;
  await getEmailSender().send({
    to: booking.guestEmail || "guest@example.com",
    template: "booking_accepted",
    subject: "Your booking was accepted",
    payload: { bookingId: id },
  });
  return { booking: updated, calendarSyncWarning };
}

export async function declineBooking(id: string, reason?: string) {
  void reason;
  const booking = await getBookingById(id);
  if (!booking) return { error: "not_found" as const, message: "Booking not found", status: 404 };
  if (booking.status !== "requested") {
    return { error: "invalid_status" as const, message: "Booking is not requested", status: 409 };
  }
  if (booking.stripePaymentIntentId) {
    await cancelPaymentIntent(booking.stripePaymentIntentId);
  }
  const decidedAt = new Date().toISOString();
  if (isDemoMode()) {
    getStore().updateBooking(id, { status: "declined", decidedAt });
  } else {
    await query(
      `UPDATE bookings SET status = 'declined', decided_at = $2 WHERE id = $1`,
      [id, decidedAt]
    );
  }
  if (booking.googleEventId) {
    const space = await getSpaceById(booking.spaceId);
    await deleteGoogleBookingEvent(space, booking.googleEventId);
  }
  const updated = (await getBookingById(id))!;
  await getEmailSender().send({
    to: booking.guestEmail || "guest@example.com",
    template: "booking_declined",
    subject: "Your booking request was declined",
    payload: { bookingId: id },
  });
  return { booking: updated };
}

export async function chargeOvertime(id: string, extraMinutes: number, note?: string) {
  void note;
  const booking = await getBookingById(id);
  if (!booking) return { error: "not_found" as const, message: "Booking not found", status: 404 };
  if (!["accepted", "in_progress", "completed"].includes(booking.status)) {
    return { error: "invalid_status" as const, message: "Cannot charge overtime", status: 409 };
  }
  const space = await getSpaceById(booking.spaceId);
  if (!space) return { error: "not_found" as const, message: "Space not found", status: 404 };
  let amountCents: number;
  try {
    amountCents = calculateOvertimeCents(
      extraMinutes,
      space.pricing.baseHourlyCents,
      space.pricing.overtimeMultiplier
    );
  } catch (e) {
    return {
      error: "bad_request" as const,
      message: e instanceof Error ? e.message : "Invalid overtime",
      status: 400,
    };
  }
  const pi = await createOvertimePaymentIntent({
    amountCents,
    currency: booking.currency,
    metadata: { bookingId: id, extraMinutes: String(extraMinutes) },
  });
  if (isDemoMode()) {
    getStore().paymentEvents.push({
      id: randomUUID(),
      bookingId: id,
      type: "overtime_charge",
      amountCents,
      stripeObjectId: pi.paymentIntentId,
    });
  }
  return {
    amountCents,
    status: pi.status,
    paymentIntentId: pi.paymentIntentId,
    clientSecret: pi.clientSecret,
  };
}

export async function listHostBookings(opts: {
  status?: string;
  from?: string;
  to?: string;
}) {
  if (isDemoMode()) {
    return getStore().listHostBookings(opts);
  }
  // All spaces for the seeded host (multi-location ready)
  const params: unknown[] = [IDS.host];
  let sql = `SELECT b.id FROM bookings b
    JOIN spaces s ON s.id = b.space_id
    WHERE s.host_id = $1`;
  if (opts.status) {
    params.push(opts.status);
    sql += ` AND b.status = $${params.length}`;
  }
  if (opts.from) {
    params.push(opts.from);
    sql += ` AND b.ends_at > $${params.length}`;
  }
  if (opts.to) {
    params.push(opts.to);
    sql += ` AND b.starts_at < $${params.length}`;
  }
  sql += ` ORDER BY b.starts_at ASC`;
  const { rows } = await query(sql, params);
  const out: Booking[] = [];
  for (const r of rows) {
    const b = await getBookingById(String(r.id));
    if (b) out.push(b);
  }
  return out;
}
