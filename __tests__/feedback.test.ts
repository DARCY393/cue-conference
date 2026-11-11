import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { feedbackIsDue, getFeedback, resetFeedbackDemoState, saveFeedback, sendDueFeedbackRequests } from "../lib/feedback";
import { getStore, resetStore } from "../lib/store";
import { setEmailSender, type EmailMessage } from "../lib/email";
import { createBookingRequest, sanitizeBookingForPublic, listHostBookings } from "../lib/bookings";
import { IDS } from "../lib/seed";
import { bookingAccessToken } from "../lib/booking-access";
import { renderFeedbackRequestEmail, renderHostFeedbackEmail } from "../lib/email-templates";
import { PUT } from "../app/api/v1/bookings/[bookingId]/feedback/route";
import { NextRequest } from "next/server";

const now = new Date("2027-01-05T15:00:00Z");
let sent: EmailMessage[];
async function completed() {
  const result = await createBookingRequest({ spaceId: IDS.m1, startsAt: "2027-01-04T15:00:00Z", endsAt: "2027-01-04T17:00:00Z", guest: { name: "Test", email: "feedback@mail.grokbot.com" } });
  if (!("booking" in result)) throw new Error("fixture failed");
  const b = getStore().bookings.find((b) => b.id === result.booking.id)!;
  b.status = "completed";
  b.completedAt = b.endsAt;
  return b;
}
beforeEach(() => {
  resetStore(); resetFeedbackDemoState(); sent = [];
  vi.useFakeTimers(); vi.setSystemTime(new Date("2027-01-01T15:00:00Z"));
  vi.stubEnv("FEEDBACK_ENABLED", "true"); vi.stubEnv("FEEDBACK_STARTS_AT", "2027-01-01T00:00:00Z");
  vi.stubEnv("CUE_APP_ENV", "preview"); vi.stubEnv("HOST_EMAIL", "host@example.com");
  setEmailSender({ async send(m) { sent.push(m); } });
});
afterEach(() => { setEmailSender(null); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("feedback due time", () => {
  it("waits for 9 AM Chicago on the day after checkout", () => {
    expect(feedbackIsDue("2027-01-04T17:00:00Z", new Date("2027-01-05T14:59:59Z"))).toBe(false);
    expect(feedbackIsDue("2027-01-04T17:00:00Z", now)).toBe(true);
    expect(feedbackIsDue("2027-01-04T17:00:00Z", new Date("2027-01-06T08:00:00Z"))).toBe(true);
  });
  it("uses wall time across both DST transitions and year boundaries", () => {
    expect(feedbackIsDue("2027-03-13T23:00:00Z", new Date("2027-03-14T13:59:00Z"))).toBe(false);
    expect(feedbackIsDue("2027-03-13T23:00:00Z", new Date("2027-03-14T14:00:00Z"))).toBe(true);
    expect(feedbackIsDue("2027-11-06T22:00:00Z", new Date("2027-11-07T15:00:00Z"))).toBe(true);
    expect(feedbackIsDue("2026-12-31T23:00:00Z", new Date("2027-01-01T15:00:00Z"))).toBe(true);
  });
});

it("sends once after cutoff with preview prefix and no Google review", async () => {
  await completed(); vi.setSystemTime(now); sent = [];
  expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(1);
  expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(0);
  expect(sent).toHaveLength(1); expect(sent[0].subject).toMatch(/^\[PREVIEW\]/);
  expect(sent[0].html).not.toMatch(/google|review/i);
  expect(sent[0].html?.match(/aria-label="Rate/g)).toHaveLength(5);
});
it("skips cancelled, declined, missing email, pre-cutoff and real preview guests", async () => {
  const b = await completed(); vi.setSystemTime(now); sent = [];
  b.status = "cancelled"; expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(0);
  b.status = "declined"; expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(0);
  b.status = "completed"; b.guestEmail = ""; expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(0);
  b.guestEmail = "real@example.com"; expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(0);
  b.guestEmail = "bot@mail.grokbot.com";
  vi.stubEnv("FEEDBACK_STARTS_AT", "2027-01-05T00:00:00Z"); expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(0);
  expect(sent).toHaveLength(0);
});
it("retries explicit delivery failures, and remains off until enabled", async () => {
  await completed(); vi.setSystemTime(now);
  setEmailSender({ async send() { return { status: "failed" }; } });
  expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(0);
  setEmailSender({ async send(m) { sent.push(m); } });
  expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(1);
  vi.stubEnv("FEEDBACK_ENABLED", "false"); expect((await sendDueFeedbackRequests()).sentIds).toHaveLength(0);
});
it("records one-click ratings, preserves comment, updates idempotently and alerts on Submit only", async () => {
  const b = await completed(); vi.setSystemTime(now); sent = [];
  await saveFeedback(b.id, { rating: 4 }, false);
  expect(await getFeedback(b.id)).toEqual({ rating: 4, comment: "" }); expect(sent).toHaveLength(0);
  await saveFeedback(b.id, { rating: 2, comment: "Room too warm" }, true);
  await saveFeedback(b.id, { rating: 2, comment: "Room too warm" }, true);
  expect(sent).toHaveLength(1); expect(sent[0].subject).toContain("ACTION NEEDED");
  expect(sent[0].to).toBe("host@example.com"); expect(sent[0].text).toContain("Room too warm");
  await saveFeedback(b.id, { rating: 5 }, false);
  expect(await getFeedback(b.id)).toEqual({ rating: 5, comment: "Room too warm" });
  await saveFeedback(b.id, { rating: 5, comment: "Great" }, true);
  expect(sent).toHaveLength(2); expect(sent[1].subject).not.toContain("ACTION NEEDED");
  const host = (await listHostBookings({})).find((x) => x.id === b.id)!;
  expect(host.feedback?.rating).toBe(5); expect(sanitizeBookingForPublic(host).feedback).toBeUndefined();
});
it("validates rating and comment, restricts incomplete bookings, requires a token", async () => {
  const b = await completed(); vi.setSystemTime(now);
  for (const rating of [0, 6, 2.5, "4", null]) expect((await saveFeedback(b.id, { rating }, true)).ok).toBe(false);
  expect((await saveFeedback(b.id, { rating: 4, comment: "x".repeat(4001) }, true)).ok).toBe(false);
  const call = (token: string) => PUT(new NextRequest("https://preview.test/api", { method: "PUT", body: JSON.stringify({ token, rating: 4 }) }), { params: Promise.resolve({ bookingId: b.id }) });
  expect((await call("wrong")).status).toBe(404);
  expect((await call(bookingAccessToken(b.id))).status).toBe(200);
  b.status = "accepted"; expect((await saveFeedback(b.id, { rating: 4 }, true)).ok).toBe(false);
});
it("escapes host comments and uses the real logo", () => {
  const p = { roomName: "M1", startsAt: "2027-01-04T15:00:00Z", endsAt: "2027-01-04T17:00:00Z", url: "https://preview.test/feedback?t=abc" };
  const email = renderHostFeedbackEmail({ ...p, rating: 1, comment: "<script>alert(1)</script>", bookingId: "id" });
  expect(email.html).toContain("&lt;script&gt;"); expect(email.html).not.toContain("<script>");
  expect(renderFeedbackRequestEmail(p).html).toContain("/branding/logo-cue-light.png");
});
