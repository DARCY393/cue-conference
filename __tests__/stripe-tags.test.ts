import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSpy = vi.fn(async (params: Record<string, unknown>) => ({
  id: "pi_test_123",
  client_secret: "pi_test_123_secret_abc",
  status: "succeeded",
  ...params,
}));

vi.mock("stripe", () => ({
  default: class {
    paymentIntents = { create: createSpy };
  },
}));

import {
  STATEMENT_DESCRIPTOR_MAX,
  STATEMENT_DESCRIPTOR_SUFFIX,
  businessMetadata,
  isValidDescriptorSuffix,
  paymentDescription,
  paymentIntentTags,
} from "../lib/stripe-tags";
import { createManualCapturePaymentIntent, createOvertimePaymentIntent } from "../lib/stripe";
import * as stripeLib from "../lib/stripe";
import { chargeOvertime, createBookingRequest } from "../lib/bookings";
import { IDS } from "../lib/seed";
import { getStore, resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";

const tagInput = {
  bookingId: "b-1",
  roomSlug: "arts-district-m1",
  roomName: "M1 Meeting Room",
  location: "Arts District",
};

describe("stripe business tags", () => {
  it("builds the filterable metadata", () => {
    expect(businessMetadata(tagInput)).toEqual({
      business: "cue_arts_district_conference_room",
      business_label: "Cue Arts District Conference Room",
      booking_id: "b-1",
      room_slug: "arts-district-m1",
      location: "Arts District",
    });
  });

  it("drops empty values and keeps extras as strings", () => {
    const md = businessMetadata({ bookingId: "b-2" }, { extraMinutes: "30", empty: "" });
    expect(md).toEqual({
      business: "cue_arts_district_conference_room",
      business_label: "Cue Arts District Conference Room",
      booking_id: "b-2",
      extraMinutes: "30",
    });
  });

  it("formats the description", () => {
    expect(paymentDescription(tagInput)).toBe("Cue Arts District Conference Room – M1 Meeting Room – booking b-1");
    expect(paymentDescription(tagInput, "overtime")).toBe(
      "Cue Arts District Conference Room – M1 Meeting Room – booking b-1 – overtime"
    );
  });

  it("suffix fits Stripe's 22-char combined limit with the account's CUE prefix", () => {
    expect(isValidDescriptorSuffix(STATEMENT_DESCRIPTOR_SUFFIX)).toBe(true);
    expect(isValidDescriptorSuffix(STATEMENT_DESCRIPTOR_SUFFIX, 10)).toBe(false);
    expect(`CUE* ${STATEMENT_DESCRIPTOR_SUFFIX}`.length).toBeLessThanOrEqual(STATEMENT_DESCRIPTOR_MAX);
    expect(isValidDescriptorSuffix("BAD*CHAR")).toBe(false);
    expect(isValidDescriptorSuffix("12345")).toBe(false);
    expect(isValidDescriptorSuffix("THIS SUFFIX IS FAR TOO LONG")).toBe(false);
  });
});

describe("stripe PaymentIntent params", () => {
  const prevKey = process.env.STRIPE_SECRET_KEY;
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    createSpy.mockClear();
  });
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = prevKey;
  });

  it("manual-capture PI carries metadata, description and suffix, no full descriptor", async () => {
    const tags = paymentIntentTags(tagInput);
    await createManualCapturePaymentIntent({
      amountCents: 7000,
      currency: "usd",
      metadata: tags.metadata,
      description: tags.description,
    });
    const params = createSpy.mock.calls[0][0];
    expect(params).toMatchObject({
      capture_method: "manual",
      metadata: tags.metadata,
      description: tags.description,
      statement_descriptor_suffix: "CUE ARTS DIST",
    });
    expect(params).not.toHaveProperty("statement_descriptor");
  });

  it("off-session overtime PI carries the same tags", async () => {
    const tags = paymentIntentTags(tagInput, { note: "overtime" });
    await createOvertimePaymentIntent({
      amountCents: 1000,
      currency: "usd",
      metadata: tags.metadata,
      description: tags.description,
    });
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      off_session: true,
      metadata: expect.objectContaining({ business: "cue_arts_district_conference_room", booking_id: "b-1" }),
      description: "Cue Arts District Conference Room – M1 Meeting Room – booking b-1 – overtime",
      statement_descriptor_suffix: "CUE ARTS DIST",
    });
  });
});

describe("bookings tag their PaymentIntents", () => {
  beforeEach(() => {
    resetStore();
    clearMock();
    vi.restoreAllMocks();
  });

  it("booking auth PI uses the booking's own id", async () => {
    const spy = vi.spyOn(stripeLib, "createManualCapturePaymentIntent");
    const result = await createBookingRequest({
      spaceId: IDS.m1,
      startsAt: "2027-01-04T15:00:00.000Z",
      endsAt: "2027-01-04T16:00:00.000Z",
      guest: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    if (!("booking" in result)) throw new Error("expected a booking");
    const id = result.booking.id;
    const args = spy.mock.calls[0][0];
    expect(args.metadata).toMatchObject({
      business: "cue_arts_district_conference_room",
      business_label: "Cue Arts District Conference Room",
      booking_id: id,
      bookingId: id,
      room_slug: "arts-district-m1",
    });
    expect(args.metadata.location).toBeTruthy();
    expect(args.description).toBe(`Cue Arts District Conference Room – M1 Meeting Room – booking ${id}`);
    expect(args.statementDescriptorSuffix).toBe("CUE ARTS DIST");
  });

  it("overtime PI is tagged with the booking id", async () => {
    const result = await createBookingRequest({
      spaceId: IDS.m3,
      startsAt: "2027-01-05T15:00:00.000Z",
      endsAt: "2027-01-05T16:00:00.000Z",
      guest: { name: "Grace Hopper", email: "grace@example.com" },
    });
    if (!("booking" in result)) throw new Error("expected a booking");
    const stored = getStore().bookings.find((b) => b.id === result.booking.id)!;
    stored.status = "accepted";
    const spy = vi.spyOn(stripeLib, "createOvertimePaymentIntent");
    await chargeOvertime(stored.id, 30);
    const args = spy.mock.calls[0][0];
    expect(args.metadata).toMatchObject({
      business: "cue_arts_district_conference_room",
      booking_id: stored.id,
      charge_type: "overtime",
      room_slug: "arts-district-m3",
    });
    expect(args.description).toBe(`Cue Arts District Conference Room – M3 Meeting Room – booking ${stored.id} – overtime`);
  });
});
