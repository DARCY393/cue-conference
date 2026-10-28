import { randomUUID } from "crypto";
import { calculateQuote, calculateOvertimeCents, computeAddonCents } from "./quote";
import { calculateCancellationRefund, CANCELLATION_DEFAULT } from "./refund";
import { expandDayWindows, isAvailable, totalWindowHours } from "./availability";
import {
  ACCEPT_START_PASSED_MESSAGE,
  isStartInPast,
  localDateString,
  START_IN_PAST_MESSAGE,
} from "./booking-window";
import { getBusy, getSpaceById } from "./space-service";
import { getStore, isDemoMode } from "./store";
import { query } from "./db";
import {
  createManualCapturePaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  createRefund,
  getRefundedCents,
  createOvertimePaymentIntent,
  retrievePaymentIntent,
} from "./stripe";
import { getEmailSender } from "./email";
import { sendHostSms } from "./sms";
import { cancelledSms, newRequestSms } from "./host-alerts";
import { cancelPageUrl } from "./booking-access";
import {
  renderBookingRequestedEmail,
  renderHostNewRequestEmail,
  renderBookingDeclinedEmail,
  renderBookingCancelledEmail,
  renderHostBookingCancelledEmail,
  renderBookingExpiredEmail,
  renderBookingConfirmationEmail,
  type BookingEmailParams,
} from "./email-templates";
import { getGoogleBusy, createGoogleBookingEvent, deleteGoogleBookingEvent } from "./google-calendar";
import type { Booking, QuoteAddonInput, SpacePublic } from "./types";
import { IDS } from "./seed";
import { paymentIntentTags } from "./stripe-tags";

const HOST_ACTION_HOURS = 24;
/** A draft (guest clicked "Continue to payment" but never authorized a card) is discarded after this. */
export const DRAFT_TTL_MINUTES = 30;
/** PaymentIntent statuses that mean the card hold is in place (manual capture). */
const AUTHORIZED_PI_STATUSES = new Set(["requires_capture"]);

function isValidRequestKey(k: unknown): k is string {
  return typeof k === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(k);
}

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

function roomNameFor(space: SpacePublic | null | undefined, booking: Booking): string {
  return space?.shortTitle || space?.title || booking.spaceTitle || "your room";
}

function bookingEmailParams(booking: Booking, space: SpacePublic | null | undefined): BookingEmailParams {
  return {
    roomName: roomNameFor(space, booking),
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    totalCents: booking.totalCents,
    parkingPasses: booking.parkingPasses ?? 0,
    parkingCents: booking.parkingCents ?? 0,
    bookingId: booking.id,
    subtotalCents: booking.subtotalCents,
    discountCents: booking.discountCents,
    discountLabel: booking.quoteJson?.lineItems?.find((l) => l.code === "discount_long_booking")?.label,
    cancelUrl: cancelPageUrl(booking.id),
  };
}

async function sendBookingRequestedEmails(booking: Booking, space: SpacePublic | null | undefined) {
  const params = bookingEmailParams(booking, space);
  const requested = renderBookingRequestedEmail(params);
  await getEmailSender().send({
    to: booking.guestEmail || "guest@example.com",
    template: "booking_requested",
    subject: requested.subject,
    html: requested.html,
    text: requested.text,
  });
  const host = renderHostNewRequestEmail({
    ...params,
    guestName: booking.guestName || "Guest",
    guestEmail: booking.guestEmail || "",
    hostActionDeadlineAt: booking.hostActionDeadlineAt,
  });
  await getEmailSender().send({
    to: process.env.HOST_EMAIL || "host@example.com",
    template: "host_new_request",
    subject: host.subject,
    html: host.html,
    text: host.text,
  });
  await sendHostSms(
    newRequestSms({
      roomName: params.roomName,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      totalCents: booking.totalCents,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      hostActionDeadlineAt: booking.hostActionDeadlineAt,
    }),
    `new_request ${booking.id}`
  );
}

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

/** Strip internal calendar-sync/reminder fields before a booking is serialized to any API response. */
export function sanitizeBookingForApi(b: Booking): Booking {
  const copy = { ...b };
  delete copy.googleEventId;
  delete copy.reminderSentAt;
  delete copy.hostReminder6hSentAt;
  delete copy.hostReminder2hSentAt;
  delete copy.clientRequestKey;
  delete copy.cancelClaimedAt;
  return copy;
}

/** For unauthenticated, id-addressed endpoints: also strip the guest's name and email. */
export function sanitizeBookingForPublic(b: Booking): Booking {
  const copy = sanitizeBookingForApi(b);
  delete copy.guestEmail;
  delete copy.guestName;
  delete copy.guestNotes;
  delete copy.activityDescription;
  delete copy.stripeRefundId;
  return copy;
}

export type ApiErr = { ok: false; error: string; message: string; status: number };
export type QuoteOk = {
  ok: true;
  quote: import("./types").Quote;
  space: SpacePublic;
  /** Reservation span actually billed/reserved: first day's start to last day's end. */
  range: { startsAt: Date; endsAt: Date };
};

/**
 * `startsAt`/`endsAt` give the daily start/end time-of-day (and, for a
 * single-day booking, the only day). `endDate` is the optional calendar date
 * of the last day for a multi-day reservation (default = same day as
 * `startsAt`) — see `expandDayWindows()` in `lib/availability.ts`.
 */
export async function createQuoteForSpace(
  spaceId: string,
  startsAt: Date,
  endsAt: Date,
  addons?: QuoteAddonInput[],
  endDate?: Date | null,
  parkingPasses?: number
): Promise<QuoteOk | ApiErr> {
  const space = await getSpaceById(spaceId);
  if (!space) {
    return { ok: false, error: "not_found", message: "Space not found", status: 404 };
  }
  // A span whose end falls on a later local day than its start is a multi-day
  // reservation even when the caller omitted endDate: treat endsAt's day as the
  // last day (as authorize/accept already do), so every day in the span is
  // priced and checked for conflicts — not just the first one.
  const effectiveEndDate =
    endDate ??
    (localDateString(endsAt, space.timezone) > localDateString(startsAt, space.timezone) ? endsAt : null);
  const windows = expandDayWindows(startsAt, endsAt, effectiveEndDate, space.timezone, space.bookableHours);
  if (windows.length > 0 && isStartInPast(windows[0].startsAt)) {
    return { ok: false, error: "start_in_past", message: START_IN_PAST_MESSAGE, status: 409 };
  }
  if (windows.length === 0) {
    return {
      ok: false,
      error: "outside_bookable_hours",
      message: "Requested time is outside Mon–Fri 8:00am–6:00pm CT.",
      status: 409,
    };
  }
  const rangeStart = windows[0].startsAt;
  const rangeEnd = windows[windows.length - 1].endsAt;

  const busy = await getBusy(spaceId, rangeStart, rangeEnd);
  const googleBusy = await getGoogleBusy(space, rangeStart, rangeEnd);
  if (!googleBusy.ok) {
    return {
      ok: false,
      error: googleBusy.error,
      message: googleBusy.message,
      status: 409,
    };
  }
  const allBusy = [...busy, ...googleBusy.busy];
  const available = windows.every((w) => isAvailable(w.startsAt, w.endsAt, allBusy));
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
      startsAt: rangeStart,
      endsAt: rangeEnd,
      totalHours: totalWindowHours(windows),
      pricing: space.pricing,
      addonsCatalog: space.addons,
      addonSelections: addons,
      available: true,
      roomLabel: space.shortTitle,
      parkingPasses,
    });
    return { ok: true, quote, space, range: { startsAt: rangeStart, endsAt: rangeEnd } };
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
  /** Calendar date (any ISO instant on that local day) of a multi-day reservation's last day. */
  endDate?: string;
  addons?: (QuoteAddonInput & { meta?: Record<string, unknown> })[];
  /** Reserved parking passes under the building (0-20, integer); re-validated server-side. */
  parkingPasses?: number;
  guestNotes?: string;
  activityDescription?: string;
  guest: { name: string; email: string; phone?: string };
  /**
   * Idempotency key generated by the guest's browser once per form submission. A repeat call
   * with the same key (double click, retry) returns the existing draft instead of a new one.
   */
  clientRequestKey?: string;
}): Promise<CreateBookingResult> {
  const requestKey = isValidRequestKey(body.clientRequestKey) ? body.clientRequestKey : undefined;
  if (requestKey) {
    const existing = await findBookingByRequestKey(requestKey);
    if (existing) return resumeExistingDraft(existing);
  }
  const dailyStartsAt = new Date(body.startsAt);
  const dailyEndsAt = new Date(body.endsAt);
  const quoted = await createQuoteForSpace(
    body.spaceId,
    dailyStartsAt,
    dailyEndsAt,
    body.addons,
    body.endDate ? new Date(body.endDate) : null,
    body.parkingPasses
  );
  if (!quoted.ok) {
    return { error: quoted.error, message: quoted.message, status: quoted.status };
  }
  const { quote, space, range } = quoted;
  const { startsAt, endsAt } = range;

  // Booking id is minted before the PaymentIntent so the PI can carry it (metadata + description).
  const bookingId = randomUUID();
  const tags = paymentIntentTags(
    {
      bookingId,
      roomSlug: space.slug,
      roomName: space.title || space.shortTitle,
      location: space.location?.name,
    },
    { extra: { spaceId: body.spaceId, bookingId, guestEmail: body.guest.email } }
  );
  const stripe = await createManualCapturePaymentIntent({
    amountCents: quote.totalCents,
    currency: quote.currency,
    metadata: tags.metadata,
    description: tags.description,
    statementDescriptorSuffix: tags.statement_descriptor_suffix,
    customerEmail: body.guest.email,
    // Room-only fee base (APPLICATION_FEE_ROOM_ONLY=true): room time after discount, no parking/add-ons.
    roomCents: Math.max(0, quote.baseCents - quote.discountCents),
  });

  const now = new Date();
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
      id: bookingId,
      spaceId: body.spaceId,
      guestId: guest.id,
      // Draft until Stripe reports the card hold as authorized (see authorizeBooking).
      status: "draft",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      guestNotes: body.guestNotes,
      activityDescription: body.activityDescription,
      currency: quote.currency,
      subtotalCents: quote.baseCents,
      discountCents: quote.discountCents,
      addonsCents: quote.addonsCents,
      parkingPasses: quote.parkingPasses,
      parkingCents: quote.parkingCents,
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
      stripePaymentIntentId: stripe.paymentIntentId,
      clientRequestKey: requestKey,
      createdAt: now.toISOString(),
      guestEmail: body.guest.email,
      guestName: body.guest.name,
      quoteJson: quote,
    };
    if (requestKey) {
      const raced = getStore().bookings.find((b) => b.clientRequestKey === requestKey);
      if (raced) {
        await cancelPaymentIntent(stripe.paymentIntentId).catch(() => undefined);
        return resumeExistingDraft(toBookingPublic(raced, space));
      }
    }
    // Same guest + room + time already has an open draft from an earlier form: replace it.
    const sameSlot = getStore().bookings.find(
      (b) =>
        b.status === "draft" &&
        b.spaceId === booking.spaceId &&
        b.guestId === booking.guestId &&
        b.startsAt === booking.startsAt &&
        b.endsAt === booking.endsAt
    );
    if (sameSlot) await discardDraftBooking(sameSlot.id, "cancelled");
    getStore().createBooking(booking);
    return finishDraft(toBookingPublic(booking, space), stripe);
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

  const insertDraft = () =>
    query(
    `INSERT INTO bookings (
      id, space_id, guest_id, status, starts_at, ends_at, guest_notes, activity_description,
      quote_json, currency, subtotal_cents, discount_cents, addons_cents, parking_passes, parking_cents,
      fees_cents, tax_cents, total_cents,
      cancellation_policy_id, requested_at, host_action_deadline_at, stripe_payment_intent_id,
      client_request_key
    ) VALUES (
      $1,$2,$3,'draft',$4,$5,$6,$7,$8,'usd',$9,$10,$11,$12,$13,$14,$15,$16,$17,NULL,NULL,$18,$19
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
      quote.parkingPasses,
      quote.parkingCents,
      quote.feesCents,
      quote.taxCents,
      quote.totalCents,
      IDS.policy,
      stripe.paymentIntentId,
      requestKey ?? null,
    ]
  );

  try {
    await insertDraft();
  } catch (err) {
    if (pgCode(err) !== "23505") throw err;
    // Unique violation: either the same request key raced us (double click) or this guest
    // already has an open draft/request for this exact room + time.
    if (requestKey) {
      const raced = await findBookingByRequestKey(requestKey);
      if (raced) {
        await cancelPaymentIntent(stripe.paymentIntentId).catch(() => undefined);
        return resumeExistingDraft(raced);
      }
    }
    const { rows: open } = await query<{ id: string; status: string }>(
      `SELECT id, status FROM bookings
       WHERE space_id = $1 AND guest_id = $2 AND starts_at = $3 AND ends_at = $4
         AND status IN ('draft','requested')`,
      [body.spaceId, guestId, startsAt.toISOString(), endsAt.toISOString()]
    );
    if (open.some((r) => r.status === "requested")) {
      await cancelPaymentIntent(stripe.paymentIntentId).catch(() => undefined);
      return {
        error: "duplicate_request",
        message: "You already have a request in for this room and time.",
        status: 409,
      };
    }
    // An earlier, abandoned draft from this guest for the same slot: replace it.
    for (const r of open) await discardDraftBooking(r.id, "cancelled");
    await insertDraft();
  }

  for (const r of resolved) {
    await query(
      `INSERT INTO booking_addons (booking_id, addon_id, quantity, unit_price_cents, meta_json)
       VALUES ($1,$2,$3,$4,$5)`,
      [bookingId, r.addon.id, r.quantity, r.unitPriceCents, JSON.stringify(r.meta ?? {})]
    );
  }

  const booking = await getBookingById(bookingId);
  return finishDraft(booking!, stripe);
}

type StripeHold = Awaited<ReturnType<typeof createManualCapturePaymentIntent>>;

/**
 * A new draft has no emails and no host visibility. With mocked Stripe (no keys) there is no card
 * step, so the mock hold counts as authorized right away.
 */
async function finishDraft(booking: Booking, stripe: StripeHold): Promise<CreateBookingResult> {
  if (stripe.clientSecret.includes("_secret_mock")) {
    const auth = await authorizeBooking(booking.id);
    if ("error" in auth) return auth;
    return { booking: auth.booking, stripe };
  }
  return { booking, stripe };
}

async function findBookingByRequestKey(key: string): Promise<Booking | null> {
  if (isDemoMode()) {
    const b = getStore().bookings.find((x) => x.clientRequestKey === key);
    return b ? getBookingById(b.id) : null;
  }
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM bookings WHERE client_request_key = $1`,
    [key]
  );
  return rows[0] ? getBookingById(String(rows[0].id)) : null;
}

/** Repeat submit with the same request key: hand back the same draft and its PaymentIntent. */
async function resumeExistingDraft(existing: Booking): Promise<CreateBookingResult> {
  if (existing.status !== "draft" || !existing.stripePaymentIntentId) {
    return {
      error: "already_submitted",
      message:
        existing.status === "requested" || existing.status === "accepted"
          ? "This request was already submitted."
          : "This checkout was closed. Please start again.",
      status: 409,
    };
  }
  const pi = await retrievePaymentIntent(existing.stripePaymentIntentId);
  if (!pi.clientSecret || pi.status === "canceled") {
    return { error: "already_submitted", message: "This checkout was closed. Please start again.", status: 409 };
  }
  return {
    booking: existing,
    stripe: { paymentIntentId: pi.id, clientSecret: pi.clientSecret, captureMethod: "manual" },
  };
}

export type AuthorizeResult =
  | { error: string; message: string; status: number }
  | { booking: Booking; alreadyAuthorized: boolean };

/**
 * Promote a draft to a real request once Stripe says the card hold is authorized. Only then do the
 * guest "request received" email and the host alert go out. Idempotent: called by the guest's
 * browser after confirmPayment and by the payment_intent.amount_capturable_updated webhook.
 */
export async function authorizeBooking(id: string): Promise<AuthorizeResult> {
  const booking = await getBookingById(id);
  if (!booking) return { error: "not_found", message: "Booking not found", status: 404 };
  if (booking.status !== "draft") {
    if (["requested", "accepted", "in_progress", "completed"].includes(booking.status)) {
      return { booking, alreadyAuthorized: true };
    }
    return { error: "invalid_status", message: "This checkout was closed. Please start again.", status: 409 };
  }
  if (!booking.stripePaymentIntentId) {
    return { error: "payment_not_authorized", message: "No payment on this booking", status: 409 };
  }
  const pi = await retrievePaymentIntent(booking.stripePaymentIntentId);
  if (!AUTHORIZED_PI_STATUSES.has(pi.status)) {
    return {
      error: "payment_not_authorized",
      message: `Card not authorized yet (status ${pi.status}).`,
      status: 409,
    };
  }
  if (!pi.mock && pi.amountCents !== booking.totalCents) {
    return { error: "amount_mismatch", message: "Payment amount does not match the booking", status: 409 };
  }

  const space = await getSpaceById(booking.spaceId);
  const startsAt = new Date(booking.startsAt);
  const endsAt = new Date(booking.endsAt);
  // Drafts don't hold inventory, so re-check the slot now that the card is authorized.
  const windows = space
    ? expandDayWindows(startsAt, endsAt, endsAt, space.timezone, space.bookableHours)
    : [{ startsAt, endsAt }];
  const slotTaken = () => discardDraftBooking(id, "cancelled");
  // The draft may have sat open past its start time (e.g. a tab left open): never promote it.
  if (isStartInPast(windows.length > 0 ? windows[0].startsAt : startsAt)) {
    await slotTaken();
    return {
      error: "start_in_past",
      message: `${START_IN_PAST_MESSAGE} Your card hold has been released.`,
      status: 409,
    };
  }
  let busy = await getBusy(booking.spaceId, startsAt, endsAt);
  if (space) {
    // Fail closed: if the room calendar can't be read we can't prove the slot is free.
    // Keep the draft (the guest can retry) rather than promoting it blind.
    const g = await getGoogleBusy(space, startsAt, endsAt);
    if (!g.ok) return { error: g.error, message: g.message, status: 409 };
    busy = [...busy, ...g.busy];
  }
  if (!windows.every((w) => isAvailable(w.startsAt, w.endsAt, busy))) {
    await slotTaken();
    return {
      error: "slot_unavailable",
      message: "Sorry, that time was just booked. Your card hold has been released.",
      status: 409,
    };
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + HOST_ACTION_HOURS * 60 * 60 * 1000);
  if (isDemoMode()) {
    const b = getStore().getBooking(id);
    if (!b || b.status !== "draft") {
      const cur = await getBookingById(id);
      return cur ? { booking: cur, alreadyAuthorized: true } : { error: "not_found", message: "Booking not found", status: 404 };
    }
    getStore().updateBooking(id, {
      status: "requested",
      requestedAt: now.toISOString(),
      hostActionDeadlineAt: deadline.toISOString(),
    });
  } else {
    let promoted: number;
    try {
      // Atomic: exactly one caller (browser or webhook) wins and sends the emails.
      const res = await query(
        `UPDATE bookings SET status = 'requested', requested_at = $2, host_action_deadline_at = $3
         WHERE id = $1 AND status = 'draft'`,
        [id, now.toISOString(), deadline.toISOString()]
      );
      promoted = res.rowCount ?? 0;
    } catch (err) {
      if (pgCode(err) === "23P01" || pgCode(err) === "23505") {
        await slotTaken();
        return {
          error: "slot_unavailable",
          message: "Sorry, that time was just booked. Your card hold has been released.",
          status: 409,
        };
      }
      throw err;
    }
    if (promoted === 0) {
      const cur = await getBookingById(id);
      return cur ? { booking: cur, alreadyAuthorized: true } : { error: "not_found", message: "Booking not found", status: 404 };
    }
  }
  const updated = (await getBookingById(id))!;
  await sendBookingRequestedEmails(updated, space);
  return { booking: updated, alreadyAuthorized: false };
}

/**
 * Throw away a draft (guest changed details, closed checkout, or it timed out): cancel its
 * PaymentIntent so no hold lingers. No emails — the guest never submitted a request.
 */
export async function discardDraftBooking(
  id: string,
  as: "cancelled" | "expired" = "cancelled"
): Promise<{ discarded: boolean; status?: string }> {
  const booking = await getBookingById(id);
  if (!booking || booking.status !== "draft") return { discarded: false, status: booking?.status };
  if (booking.stripePaymentIntentId) {
    // Cancel anything still open (unconfirmed or an authorized hold); never touch a captured PI.
    const pi = await retrievePaymentIntent(booking.stripePaymentIntentId).catch(() => null);
    if (!pi || (pi.status !== "canceled" && pi.status !== "succeeded")) {
      await cancelPaymentIntent(booking.stripePaymentIntentId).catch(() => undefined);
    }
  }
  const at = new Date().toISOString();
  if (isDemoMode()) {
    getStore().updateBooking(id, { status: as, cancelledAt: at });
  } else {
    await query(`UPDATE bookings SET status = $2, cancelled_at = $3 WHERE id = $1 AND status = 'draft'`, [
      id,
      as,
      at,
    ]);
  }
  return { discarded: true, status: as };
}

export async function getBookingById(id: string): Promise<Booking | null> {
  if (isDemoMode()) {
    const b = getStore().getBooking(id);
    if (!b) return null;
    const space = getStore().getSpaceById(b.spaceId);
    return toBookingPublic(b, space);
  }
  const { rows } = await query<Record<string, unknown>>(
    // Join the guest so emails go to the real guest address (same fields as demo mode).
    `SELECT b.*, u.email AS guest_email, u.name AS guest_name
     FROM bookings b LEFT JOIN users u ON u.id = b.guest_id
     WHERE b.id = $1`,
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
    parkingPasses: Number(r.parking_passes ?? 0),
    parkingCents: Number(r.parking_cents ?? 0),
    feesCents: Number(r.fees_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    reminderSentAt: r.reminder_sent_at
      ? new Date(r.reminder_sent_at as string).toISOString()
      : undefined,
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
    hostReminder6hSentAt: r.host_reminder_6h_sent_at ? new Date(r.host_reminder_6h_sent_at as string).toISOString() : undefined,
    hostReminder2hSentAt: r.host_reminder_2h_sent_at ? new Date(r.host_reminder_2h_sent_at as string).toISOString() : undefined,
    cancelClaimedAt: r.cancel_claimed_at ? new Date(r.cancel_claimed_at as string).toISOString() : undefined,
    refundCents: r.refund_cents == null ? undefined : Number(r.refund_cents),
    stripeRefundId: (r.stripe_refund_id as string) ?? undefined,
    cancellationAction: (r.cancellation_action as Booking["cancellationAction"]) ?? undefined,
    cancelledBy: (r.cancelled_by as Booking["cancelledBy"]) ?? undefined,
    createdAt: new Date(r.created_at as string).toISOString(),
    guestEmail: (r.guest_email as string) ?? undefined,
    guestName: (r.guest_name as string) ?? undefined,
    clientRequestKey: (r.client_request_key as string) ?? undefined,
    quoteJson: (r.quote_json as import("./types").Quote | null) ?? undefined,
  };
  return toBookingPublic(booking, space);
}

/** A cancel claim older than this is treated as abandoned (e.g. the process died mid-cancel). */
const CANCEL_CLAIM_STALE_MS = 10 * 60 * 1000;

export type CancelActor = "guest" | "staff";

export interface CancelBookingOptions {
  actor?: CancelActor;
  reason?: string;
  /** Staff-only courtesy override: refund the full captured amount regardless of the 48h policy. */
  courtesyFullRefund?: boolean;
}

export type CancelBookingResult =
  | {
      booking: Booking;
      refundCents: number;
      refundId?: string;
      action: import("./refund").CancellationAction;
      alreadyCancelled?: boolean;
    }
  | { error: string; message: string; status: number };

/** Atomically claim the booking for cancellation. Only one concurrent caller gets `true`. */
async function claimCancellation(id: string): Promise<boolean> {
  const now = new Date();
  if (isDemoMode()) {
    const b = getStore().getBooking(id);
    if (!b || !["requested", "accepted"].includes(b.status)) return false;
    if (b.cancelClaimedAt && now.getTime() - new Date(b.cancelClaimedAt).getTime() < CANCEL_CLAIM_STALE_MS) {
      return false;
    }
    getStore().updateBooking(id, { cancelClaimedAt: now.toISOString() });
    return true;
  }
  const { rowCount } = await query(
    `UPDATE bookings SET cancel_claimed_at = $2
     WHERE id = $1 AND status IN ('requested','accepted')
       AND (cancel_claimed_at IS NULL OR cancel_claimed_at < $3)`,
    [id, now.toISOString(), new Date(now.getTime() - CANCEL_CLAIM_STALE_MS).toISOString()]
  );
  return (rowCount ?? 0) > 0;
}

async function releaseCancellationClaim(id: string): Promise<void> {
  if (isDemoMode()) {
    getStore().updateBooking(id, { cancelClaimedAt: undefined });
    return;
  }
  await query(`UPDATE bookings SET cancel_claimed_at = NULL WHERE id = $1 AND status <> 'cancelled'`, [id]);
}

/**
 * Cancel a requested or accepted booking (guest self-cancel or staff). Idempotent:
 * - the first caller atomically claims the booking before any Stripe call; a concurrent second
 *   caller gets 409 cancel_in_progress, and a later one gets the already-cancelled booking back;
 * - refunds carry a per-booking Stripe idempotency key and are skipped if the charge already
 *   shows that much refunded, so a retry after a crash never refunds twice.
 * Stripe webhooks (charge.refunded / payment_intent.canceled) only record payment_events, so they
 * can't trigger a second refund either.
 */
export async function cancelBooking(
  id: string,
  optsOrReason?: CancelBookingOptions | string
): Promise<CancelBookingResult> {
  const opts: CancelBookingOptions =
    typeof optsOrReason === "string" ? { reason: optsOrReason } : optsOrReason ?? {};
  const actor: CancelActor = opts.actor ?? "staff";
  const booking = await getBookingById(id);
  if (!booking) return { error: "not_found", message: "Booking not found", status: 404 };
  if (booking.status === "cancelled") {
    return {
      booking,
      refundCents: booking.refundCents ?? 0,
      refundId: booking.stripeRefundId,
      action: booking.cancellationAction ?? "release_hold",
      alreadyCancelled: true,
    };
  }
  if (!["requested", "accepted"].includes(booking.status)) {
    return {
      error: "invalid_status",
      message: "Only requested or accepted bookings can be cancelled",
      status: 409,
    };
  }
  if (actor === "guest" && new Date(booking.startsAt).getTime() <= Date.now()) {
    return {
      error: "start_passed",
      message: "This booking has already started, so it can't be cancelled online. Please contact us.",
      status: 409,
    };
  }

  if (!(await claimCancellation(id))) {
    const current = await getBookingById(id);
    if (current?.status === "cancelled") {
      return {
        booking: current,
        refundCents: current.refundCents ?? 0,
        refundId: current.stripeRefundId,
        action: current.cancellationAction ?? "release_hold",
        alreadyCancelled: true,
      };
    }
    return {
      error: "cancel_in_progress",
      message: "This booking is already being cancelled. Refresh in a moment.",
      status: 409,
    };
  }

  const space = await getSpaceById(booking.spaceId);
  const rules = space?.cancellationPolicy?.rules ?? CANCELLATION_DEFAULT;
  const piId = booking.stripePaymentIntentId;

  let action: import("./refund").CancellationAction;
  let refundCents = 0;
  let refundId: string | undefined;
  try {
    // Decide "captured" from Stripe itself when we can (a staff accept may have captured the hold
    // a moment ago); mock/no-Stripe falls back to the booking status.
    let piStatus: string | undefined;
    if (piId) {
      const pi = await retrievePaymentIntent(piId);
      piStatus = pi.mock ? (booking.status === "accepted" ? "succeeded" : "requires_capture") : pi.status;
    }
    const captured = piId ? piStatus === "succeeded" : booking.status === "accepted";
    let result = calculateCancellationRefund({
      now: new Date(),
      startsAt: new Date(booking.startsAt),
      totalCents: booking.totalCents,
      captured,
      rules,
    });
    if (captured && (booking.status === "requested" || (actor === "staff" && opts.courtesyFullRefund))) {
      // requested + captured = staff accepted concurrently with this cancel: the guest cancelled
      // before being charged, so they get everything back.
      result = {
        refundCents: booking.totalCents,
        action: "refund",
        reason: booking.status === "requested" ? "Cancelled while being accepted." : "Courtesy full refund (staff).",
      };
    }
    action = result.action;
    refundCents = result.refundCents;

    if (piId) {
      if (action === "release_hold") {
        if (piStatus !== "canceled") {
          await cancelPaymentIntent(piId, { idempotencyKey: `booking-cancel-release:${id}` });
        }
      } else if (action === "refund" && refundCents > 0) {
        const already = await getRefundedCents(piId);
        const remaining = refundCents - already;
        if (remaining > 0) {
          const refund = await createRefund({
            paymentIntentId: piId,
            amountCents: remaining,
            idempotencyKey: `booking-cancel-refund:${id}`,
            metadata: { booking_id: id, cancelled_by: actor },
          });
          refundId = refund.id;
        }
      }
    }
  } catch (err) {
    await releaseCancellationClaim(id);
    console.error(`[cancel] ${id}: Stripe step failed`, err instanceof Error ? err.message : err);
    return {
      error: "payment_error",
      message: "We couldn't process the cancellation with our payment provider. Nothing was changed — please try again or contact us.",
      status: 502,
    };
  }

  const cancelledAt = new Date().toISOString();
  if (isDemoMode()) {
    getStore().updateBooking(id, {
      status: "cancelled",
      cancelledAt,
      refundCents,
      stripeRefundId: refundId,
      cancellationAction: action,
      cancelledBy: actor,
    });
  } else {
    await query(
      `UPDATE bookings
       SET status = 'cancelled', cancelled_at = $2, refund_cents = $3, stripe_refund_id = $4,
           cancellation_action = $5, cancelled_by = $6
       WHERE id = $1 AND status IN ('requested','accepted')`,
      [id, cancelledAt, refundCents, refundId ?? null, action, actor]
    );
  }
  // Free the slot on the calendar; availability already ignores cancelled bookings.
  const latest = await getBookingById(id);
  const eventId = latest?.googleEventId ?? booking.googleEventId;
  if (eventId) {
    await deleteGoogleBookingEvent(space, eventId);
  }
  const updated = latest ?? booking;
  const roomName = roomNameFor(space, booking);
  try {
    const cancelled = renderBookingCancelledEmail({ roomName, refundCents, action, startsAt: booking.startsAt, endsAt: booking.endsAt });
    await getEmailSender().send({
      to: booking.guestEmail || "guest@example.com",
      template: "booking_cancelled",
      subject: cancelled.subject,
      html: cancelled.html,
      text: cancelled.text,
    });
    const host = renderHostBookingCancelledEmail({
      ...bookingEmailParams(booking, space),
      guestName: booking.guestName || "Guest",
      guestEmail: booking.guestEmail || "",
      refundCents,
      action,
      cancelledBy: actor,
      courtesy: Boolean(opts.courtesyFullRefund && actor === "staff" && action === "refund"),
    });
    await getEmailSender().send({
      to: process.env.HOST_EMAIL || "host@example.com",
      template: "host_booking_cancelled",
      subject: host.subject,
      html: host.html,
      text: host.text,
    });
    await sendHostSms(
      cancelledSms({
        roomName,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        totalCents: booking.totalCents,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        action,
        refundCents,
        cancelledBy: actor,
      }),
      `cancelled ${id}`
    );
  } catch (err) {
    console.error(`[cancel] ${id}: email failed`, err instanceof Error ? err.message : err);
  }
  return { booking: updated, refundCents, refundId, action };
}

/**
 * Idempotent: expires a single still-"requested" booking whose host response
 * window has passed, releasing its payment hold. A no-op (returns an error
 * result) if the booking has already moved on — safe to call repeatedly from
 * both the bulk scan below and any retry.
 */
export async function expireBookingRequest(id: string) {
  const booking = await getBookingById(id);
  if (!booking || booking.status !== "requested") {
    return {
      error: "invalid_status" as const,
      message: "Booking is not a pending request",
      status: 409,
    };
  }
  if (!booking.hostActionDeadlineAt || new Date(booking.hostActionDeadlineAt) > new Date()) {
    return {
      error: "not_overdue" as const,
      message: "Host response window has not passed yet",
      status: 409,
    };
  }
  if (booking.stripePaymentIntentId) {
    await cancelPaymentIntent(booking.stripePaymentIntentId);
  }
  const decidedAt = new Date().toISOString();
  if (isDemoMode()) {
    getStore().updateBooking(id, { status: "expired", decidedAt });
  } else {
    await query(
      `UPDATE bookings SET status = 'expired', decided_at = $2 WHERE id = $1 AND status = 'requested'`,
      [id, decidedAt]
    );
  }
  const updated = (await getBookingById(id))!;
  const space = await getSpaceById(booking.spaceId);
  const expired = renderBookingExpiredEmail({ roomName: roomNameFor(space, booking) });
  await getEmailSender().send({
    to: booking.guestEmail || "guest@example.com",
    template: "booking_expired",
    subject: expired.subject,
    html: expired.html,
    text: expired.text,
  });
  return { booking: updated };
}

/**
 * Scans for "requested" bookings whose `hostActionDeadlineAt` (set to
 * HOST_ACTION_HOURS after the request) has passed and auto-declines them,
 * releasing each payment hold. Called by the cron-protected internal route,
 * the `bookings:expire` script, and lazily on every host booking list read.
 */
export async function expireOverdueRequests(): Promise<{ expiredIds: string[]; expiredDraftIds: string[] }> {
  const now = new Date();
  let candidateIds: string[];
  if (isDemoMode()) {
    candidateIds = getStore()
      .bookings.filter(
        (b) =>
          b.status === "requested" &&
          b.hostActionDeadlineAt &&
          new Date(b.hostActionDeadlineAt) <= now
      )
      .map((b) => b.id);
  } else {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM bookings WHERE status = 'requested' AND host_action_deadline_at <= now()`
    );
    candidateIds = rows.map((r) => String(r.id));
  }

  const expiredIds: string[] = [];
  for (const id of candidateIds) {
    const result = await expireBookingRequest(id);
    if ("booking" in result) expiredIds.push(id);
  }

  // Abandoned checkouts: drafts never authorized within DRAFT_TTL_MINUTES. Cancel their PIs
  // silently (the guest never submitted a request, so no emails).
  const draftCutoff = new Date(now.getTime() - DRAFT_TTL_MINUTES * 60 * 1000);
  let draftIds: string[];
  if (isDemoMode()) {
    draftIds = getStore()
      .bookings.filter((b) => b.status === "draft" && new Date(b.createdAt) <= draftCutoff)
      .map((b) => b.id);
  } else {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM bookings WHERE status = 'draft' AND created_at <= $1`,
      [draftCutoff.toISOString()]
    );
    draftIds = rows.map((r) => String(r.id));
  }
  const expiredDraftIds: string[] = [];
  for (const id of draftIds) {
    const r = await discardDraftBooking(id, "expired");
    if (r.discarded) expiredDraftIds.push(id);
  }
  return { expiredIds, expiredDraftIds };
}

export async function acceptBooking(id: string) {
  const booking = await getBookingById(id);
  if (!booking) return { error: "not_found" as const, message: "Booking not found", status: 404 };
  if (booking.status !== "requested") {
    return { error: "invalid_status" as const, message: "Booking is not requested", status: 409 };
  }
  // Never capture a hold for a slot whose start time has already passed (America/Chicago).
  if (isStartInPast(new Date(booking.startsAt))) {
    return { error: "start_in_past" as const, message: ACCEPT_START_PASSED_MESSAGE, status: 409 };
  }
  const startsAt = new Date(booking.startsAt);
  const endsAt = new Date(booking.endsAt);
  const space = await getSpaceById(booking.spaceId);
  // Re-derive the reservation's per-day windows (startsAt/endsAt carry the
  // first day's start time-of-day and the last day's end time-of-day — see
  // expandDayWindows() in lib/availability.ts) so a multi-day booking's
  // off-hours/weekend gaps aren't treated as reserved on re-check.
  const windows = space
    ? expandDayWindows(startsAt, endsAt, endsAt, space.timezone, space.bookableHours)
    : [{ startsAt, endsAt }];
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
  if (!windows.every((w) => isAvailable(w.startsAt, w.endsAt, allBusy))) {
    return {
      error: "slot_unavailable" as const,
      message: "Slot conflict on re-check",
      status: 409,
    };
  }
  if (booking.cancelClaimedAt) {
    return { error: "cancel_in_progress" as const, message: "This booking is being cancelled", status: 409 };
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
  let acceptedRow = true;
  if (isDemoMode()) {
    const cur = getStore().getBooking(id);
    if (cur && cur.status === "requested" && !cur.cancelClaimedAt) {
      getStore().updateBooking(id, { status: "accepted", decidedAt, googleEventId });
    } else {
      acceptedRow = false;
    }
  } else {
    const res = await query(
      `UPDATE bookings SET status = 'accepted', decided_at = $2, google_event_id = $3
       WHERE id = $1 AND status = 'requested' AND cancel_claimed_at IS NULL`,
      [id, decidedAt, googleEventId ?? null]
    );
    acceptedRow = (res.rowCount ?? 0) > 0;
  }
  if (!acceptedRow) {
    // The guest cancelled while we were capturing; cancelBooking sees the captured PaymentIntent
    // and refunds it in full. Drop the calendar event we just created.
    if (googleEventId) await deleteGoogleBookingEvent(space, googleEventId);
    return { error: "cancel_in_progress" as const, message: "The guest cancelled this booking while it was being accepted", status: 409 };
  }
  const updated = (await getBookingById(id))!;
  const confirmation = renderBookingConfirmationEmail(bookingEmailParams(updated, space));
  await getEmailSender().send({
    to: booking.guestEmail || "guest@example.com",
    template: "booking_accepted",
    subject: confirmation.subject,
    html: confirmation.html,
    text: confirmation.text,
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
  const space = await getSpaceById(booking.spaceId);
  if (booking.googleEventId) {
    await deleteGoogleBookingEvent(space, booking.googleEventId);
  }
  const updated = (await getBookingById(id))!;
  const declined = renderBookingDeclinedEmail({ roomName: roomNameFor(space, booking) });
  await getEmailSender().send({
    to: booking.guestEmail || "guest@example.com",
    template: "booking_declined",
    subject: declined.subject,
    html: declined.html,
    text: declined.text,
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
  const otTags = paymentIntentTags(
    {
      bookingId: id,
      roomSlug: space.slug,
      roomName: space.title || space.shortTitle,
      location: space.location?.name,
    },
    { note: "overtime", extra: { bookingId: id, charge_type: "overtime", extraMinutes: String(extraMinutes) } }
  );
  const pi = await createOvertimePaymentIntent({
    amountCents,
    currency: booking.currency,
    metadata: otTags.metadata,
    description: otTags.description,
    statementDescriptorSuffix: otTags.statement_descriptor_suffix,
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
  await expireOverdueRequests();
  if (isDemoMode()) {
    return getStore().listHostBookings(opts);
  }
  // All spaces for the seeded host (multi-location ready)
  const params: unknown[] = [IDS.host];
  // Drafts are unfinished checkouts (card never authorized) — staff never see them.
  let sql = `SELECT b.id FROM bookings b
    JOIN spaces s ON s.id = b.space_id
    WHERE s.host_id = $1 AND b.status <> 'draft'`;
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
