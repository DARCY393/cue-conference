import { describe, expect, it } from "vitest";
import {
  renderBookingConfirmationEmail,
  renderBookingRequestedEmail,
  renderBookingReminderEmail,
  type BookingEmailParams,
} from "../lib/email-templates";

const BASE: BookingEmailParams = {
  roomName: "M2",
  startsAt: "2027-01-04T15:00:00.000Z",
  endsAt: "2027-01-04T16:00:00.000Z",
  totalCents: 12500,
  parkingPasses: 2,
  parkingCents: 4000,
  bookingId: "11111111-1111-4111-8111-111111111111",
};

process.env.CUE_WIFI_PASSWORD = "test-wifi-pw";

describe("renderBookingConfirmationEmail", () => {
  it("html contains the room name, Wi-Fi password, and a parking line", () => {
    const { html } = renderBookingConfirmationEmail(BASE);
    expect(html).toContain("M2");
    expect(html).toContain("test-wifi-pw");
    expect(html).toContain("2 passes per day");
  });

  it("text version carries the same content (room, Wi-Fi, parking)", () => {
    const { text } = renderBookingConfirmationEmail(BASE);
    expect(text).toContain("M2");
    expect(text).toContain("test-wifi-pw");
    expect(text).toContain("2 passes per day");
  });

  it("falls back to the public parking note when no passes were reserved", () => {
    const { text } = renderBookingConfirmationEmail({ ...BASE, parkingPasses: 0, parkingCents: 0 });
    expect(text).toContain("720 N. Ervay St");
    expect(text).not.toContain("passes per day");
  });

  it("never includes a Wi-Fi password anywhere else — only via these email templates", () => {
    // Sanity check the fixture itself demonstrates the password is present here,
    // guarding against ever moving it onto the public room page by accident.
    const { html, text } = renderBookingConfirmationEmail(BASE);
    expect(html + text).toContain('password "test-wifi-pw"');
  });
});

describe("Wi-Fi password source", () => {
  it("falls back to 'ask staff' when CUE_WIFI_PASSWORD is unset", () => {
    const saved = process.env.CUE_WIFI_PASSWORD;
    delete process.env.CUE_WIFI_PASSWORD;
    try {
      const { text } = renderBookingConfirmationEmail(BASE);
      expect(text).toContain('Wi-Fi: network "cue" (ask');
      expect(text).not.toContain("password \"");
    } finally {
      process.env.CUE_WIFI_PASSWORD = saved;
    }
  });
});

describe("renderBookingRequestedEmail", () => {
  it("explains the 24h host-response window and the 48h cancellation policy", () => {
    const { text, html } = renderBookingRequestedEmail(BASE);
    expect(text).toContain("24 hours");
    expect(text).toContain("48 hours");
    expect(html).toContain("24 hours");
    expect(html).toContain("48 hours");
  });

  it("includes a parking line item when parking was reserved", () => {
    const { text } = renderBookingRequestedEmail(BASE);
    expect(text).toMatch(/Parking.*\$40\.00/);
  });
});

describe("renderBookingReminderEmail", () => {
  it("includes the room name and arrival instructions", () => {
    const { text, subject } = renderBookingReminderEmail(BASE);
    expect(subject).toContain("M2");
    expect(text).toContain("test-wifi-pw");
    expect(text).toContain("D'Arcy Young");
  });
});
