import { cancelledSubject, hostQueueUrl, newRequestSubject, reminderSubject, shortDateRange } from "./host-alerts";
import { arrivalInstructionLines, PARKING_ENTRANCE_TEXT } from "./arrival-instructions";
import { formatMoney } from "./format";
import {
  CONTACT_NAME,
  CONTACT_PHONE_DISPLAY,
  CONTACT_SUITE,
  FREE_CANCELLATION_TEXT,
  HOLD_HEADING,
  WHAT_HAPPENS_NEXT,
  holdBodyText,
} from "./hold-copy";

const FONT_SANS = `'Public Sans', Arial, Helvetica, sans-serif`;
const FONT_DISPLAY = `'Jost', 'Trebuchet MS', Arial, sans-serif`;
const NAVY = "#213953";
const COPPER = "#b5651d";
const INK = "#221f1c";
const STONE = "#4a453f";
const STONE_LIGHT = "#78716a";
const BORDER = "#e4ded6";
const PAPER = "#faf8f5";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function emailLayout(opts: { title: string; bodyHtml: string; realLogo?: boolean }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${PAPER};font-family:${FONT_SANS};color:${INK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
            <tr>
              <td style="background:${NAVY};padding:20px 28px;">
                ${opts.realLogo ? `<img src="${escapeHtml((process.env.NEXT_PUBLIC_APP_URL || "https://book.thecue.work").replace(/\/+$/, ""))}/branding/logo-cue-light.png" width="88" alt="Cue" style="display:block;width:88px;height:auto;" />` : `<span style="font-family:${FONT_DISPLAY};font-size:22px;font-weight:400;color:#ffffff;letter-spacing:0.02em;">cue</span>`}
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-weight:400;font-size:20px;color:${NAVY};">${escapeHtml(
                  opts.title
                )}</h1>
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid ${BORDER};">
                <span style="font-size:12px;color:${STONE_LIGHT};">Cue — thecue.work</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function summaryTableHtml(rows: { label: string; value: string; highlight?: boolean }[]): string {
  const rowsHtml = rows
    .map(
      (r) => `<tr>
        <td style="padding:6px 0;font-size:14px;color:${STONE_LIGHT};">${escapeHtml(r.label)}</td>
        <td style="padding:6px 0;font-size:14px;color:${r.highlight ? COPPER : INK};font-weight:${
          r.highlight ? 600 : 400
        };text-align:right;">${escapeHtml(r.value)}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
    ${rowsHtml}
  </table>`;
}

function paragraphHtml(text: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${STONE};">${escapeHtml(text)}</p>`;
}

function listHtml(items: string[]): string {
  const itemsHtml = items
    .map(
      (item) =>
        `<li style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${STONE};">${escapeHtml(item)}</li>`
    )
    .join("");
  return `<ul style="margin:0 0 16px;padding-left:20px;">${itemsHtml}</ul>`;
}

export interface BookingEmailParams {
  roomName: string;
  startsAt: string;
  endsAt: string;
  totalCents: number;
  parkingPasses: number;
  parkingCents: number;
  bookingId: string;
  /** Room charge before the long-booking discount (optional; shown with the discount line). */
  subtotalCents?: number;
  discountCents?: number;
  /** e.g. "Long booking discount (20%)". */
  discountLabel?: string;
  /** Tokenized guest self-cancel link (see cancelPageUrl in lib/booking-access.ts). */
  cancelUrl?: string;
  /** Tokenized "who gets a parking pass" page; shown in the confirmation when parking was booked. */
  parkingUrl?: string;
}

function cancelLinkHtml(url: string | undefined, note: string): string {
  if (!url) return "";
  return `<div style="margin:4px 0 18px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border:1px solid ${COPPER};border-radius:8px;color:${COPPER};font-size:14px;font-weight:600;text-decoration:none;">Cancel booking</a>
      <p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${STONE_LIGHT};">${escapeHtml(note)}</p>
    </div>`;
}

function cancelLinkText(url: string | undefined, note: string): string[] {
  if (!url) return [];
  return ["", `Cancel booking: ${url}`, note];
}

function formatChicago(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function summaryRows(
  params: BookingEmailParams,
  opts: { totalLabel?: string } = {}
): { label: string; value: string; highlight?: boolean }[] {
  const rows: { label: string; value: string; highlight?: boolean }[] = [
    { label: "Room", value: params.roomName },
    { label: "Starts", value: formatChicago(params.startsAt) },
    { label: "Ends", value: formatChicago(params.endsAt) },
  ];
  if (params.discountCents && params.discountCents > 0) {
    if (typeof params.subtotalCents === "number") {
      rows.push({ label: "Room charge", value: formatMoney(params.subtotalCents) });
    }
    rows.push({
      label: params.discountLabel || "Long booking discount",
      value: `−${formatMoney(params.discountCents)}`,
    });
  }
  if (params.parkingCents > 0) {
    rows.push({
      label: `Parking (${params.parkingPasses} pass${params.parkingPasses === 1 ? "" : "es"})`,
      value: formatMoney(params.parkingCents),
    });
  }
  rows.push({ label: opts.totalLabel || "Total", value: formatMoney(params.totalCents), highlight: true });
  return rows;
}

function summaryLinesText(params: BookingEmailParams, opts: { totalLabel?: string } = {}): string[] {
  return summaryRows(params, opts).map((r) => `${r.label}: ${r.value}`);
}

const HOLD_TOTAL_LABEL = "Hold amount (not charged yet)";
const CANCELLATION_POLICY_TEXT =
  "Free cancellation up to 48 hours before your booking starts. No refund after that.";
const REQUEST_CANCEL_NOTE = "Need to cancel? Cancelling a request releases the card hold right away — you won't be charged.";
const CONFIRMED_CANCEL_NOTE =
  "Plans changed? Cancel at least 48 hours before your booking starts for a full refund. No refund after that.";
const REMINDER_CANCEL_NOTE =
  "Your booking starts within 48 hours, so cancelling now isn't refundable — but please still cancel so we can free the room.";

export function renderBookingRequestedEmail(params: BookingEmailParams): RenderedEmail {
  // Subject deliberately says "request" and "card hold" — nothing has been charged.
  const subject = `Request received (card hold, not charged) — ${params.roomName}`;
  const intro = `We've received your booking request for ${params.roomName}.`;
  const hold = holdBodyText(params.totalCents);
  const nextSteps = WHAT_HAPPENS_NEXT.map((s, i) => `${i + 1}. ${s.title}. ${s.body}`);
  const questions = `Questions? Reach ${CONTACT_NAME} at ${CONTACT_PHONE_DISPLAY} or visit ${CONTACT_SUITE}.`;
  const bodyHtml = `
    ${paragraphHtml(intro)}
    <div style="margin:0 0 16px;padding:14px 16px;border:1px solid #E2AC7B;background:#FBF2E9;border-radius:8px;">
      <p style="margin:0 0 6px;font-family:${FONT_DISPLAY};font-size:16px;color:${NAVY};">${escapeHtml(HOLD_HEADING)}</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${STONE};">${escapeHtml(hold)}</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:${NAVY};font-weight:500;">${escapeHtml(FREE_CANCELLATION_TEXT)}</p>
    </div>
    ${summaryTableHtml(summaryRows(params, { totalLabel: HOLD_TOTAL_LABEL }))}
    <h2 style="margin:20px 0 10px;font-family:${FONT_DISPLAY};font-weight:400;font-size:16px;color:${NAVY};">What happens next</h2>
    <ol style="margin:0 0 16px;padding-left:20px;">${WHAT_HAPPENS_NEXT.map(
      (s) =>
        `<li style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${STONE};"><strong style="color:${INK};font-weight:600;">${escapeHtml(
          s.title
        )}.</strong> ${escapeHtml(s.body)}</li>`
    ).join("")}</ol>
    ${paragraphHtml(`Cancellation policy: ${CANCELLATION_POLICY_TEXT}`)}
    ${cancelLinkHtml(params.cancelUrl, REQUEST_CANCEL_NOTE)}
    ${paragraphHtml(questions)}
  `;
  const text = [
    intro,
    "",
    `${HOLD_HEADING}.`,
    hold,
    FREE_CANCELLATION_TEXT,
    "",
    ...summaryLinesText(params, { totalLabel: HOLD_TOTAL_LABEL }),
    "",
    "What happens next:",
    ...nextSteps,
    "",
    `Cancellation policy: ${CANCELLATION_POLICY_TEXT}`,
    ...cancelLinkText(params.cancelUrl, REQUEST_CANCEL_NOTE),
    "",
    questions,
  ].join("\n");
  return { subject, html: emailLayout({ title: "Booking request received", bodyHtml }), text };
}

const PARKING_CONFIRM_NOTE =
  "You booked parking. We'll email you separately to ask who gets each pass, or you can add them now.";

function buttonHtml(url: string, label: string): string {
  return `<div style="margin:4px 0 18px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:${COPPER};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a></div>`;
}

export function renderBookingConfirmationEmail(params: BookingEmailParams): RenderedEmail {
  const subject = `Booking confirmed — ${params.roomName}`;
  const arrivalLines = arrivalInstructionLines({
    roomName: params.roomName,
    parkingPasses: params.parkingPasses,
  });
  const bodyHtml = `
    ${paragraphHtml(`Your booking for ${params.roomName} is confirmed, and the hold on your card has now been charged.`)}
    ${summaryTableHtml(summaryRows(params, { totalLabel: "Charged" }))}
    ${paragraphHtml(`Cancellation policy: ${CANCELLATION_POLICY_TEXT}`)}
    ${cancelLinkHtml(params.cancelUrl, CONFIRMED_CANCEL_NOTE)}
    ${params.parkingUrl && params.parkingPasses > 0 ? `${paragraphHtml(PARKING_CONFIRM_NOTE)}${buttonHtml(params.parkingUrl, "Add parking pass holders")}` : ""}
    <h2 style="margin:20px 0 10px;font-family:${FONT_DISPLAY};font-weight:400;font-size:16px;color:${NAVY};">Arrival instructions</h2>
    ${listHtml(arrivalLines)}
  `;
  const text = [
    `Your booking for ${params.roomName} is confirmed, and the hold on your card has now been charged.`,
    "",
    ...summaryLinesText(params, { totalLabel: "Charged" }),
    "",
    `Cancellation policy: ${CANCELLATION_POLICY_TEXT}`,
    ...cancelLinkText(params.cancelUrl, CONFIRMED_CANCEL_NOTE),
    ...(params.parkingUrl && params.parkingPasses > 0 ? ["", PARKING_CONFIRM_NOTE, `Add parking pass holders: ${params.parkingUrl}`] : []),
    "",
    "Arrival instructions:",
    ...arrivalLines.map((l) => `- ${l}`),
  ].join("\n");
  return { subject, html: emailLayout({ title: "Booking confirmed", bodyHtml }), text };
}

export function renderBookingReminderEmail(params: BookingEmailParams): RenderedEmail {
  const subject = `Reminder: your booking starts soon — ${params.roomName}`;
  const arrivalLines = arrivalInstructionLines({
    roomName: params.roomName,
    parkingPasses: params.parkingPasses,
  });
  const bodyHtml = `
    ${paragraphHtml(`This is a reminder that your booking for ${params.roomName} starts within 24 hours.`)}
    ${summaryTableHtml(summaryRows(params))}
    <h2 style="margin:20px 0 10px;font-family:${FONT_DISPLAY};font-weight:400;font-size:16px;color:${NAVY};">Arrival instructions</h2>
    ${listHtml(arrivalLines)}
    ${cancelLinkHtml(params.cancelUrl, REMINDER_CANCEL_NOTE)}
  `;
  const text = [
    `This is a reminder that your booking for ${params.roomName} starts within 24 hours.`,
    "",
    ...summaryLinesText(params),
    "",
    "Arrival instructions:",
    ...arrivalLines.map((l) => `- ${l}`),
    ...cancelLinkText(params.cancelUrl, REMINDER_CANCEL_NOTE),
  ].join("\n");
  return { subject, html: emailLayout({ title: "Your booking is coming up", bodyHtml }), text };
}

export function renderBookingDeclinedEmail(params: { roomName: string }): RenderedEmail {
  const subject = `Booking request declined — ${params.roomName}`;
  const message = `Your booking request for ${params.roomName} was declined, and the hold on your card has been released. You were not charged.`;
  return {
    subject,
    html: emailLayout({ title: "Booking request declined", bodyHtml: paragraphHtml(message) }),
    text: message,
  };
}

export function renderBookingCancelledEmail(params: {
  roomName: string;
  refundCents: number;
  /** What happened to the payment; defaults from refundCents for older callers. */
  action?: "release_hold" | "refund" | "no_refund";
  startsAt?: string;
  endsAt?: string;
}): RenderedEmail {
  const subject = `Booking cancelled — ${params.roomName}`;
  const action = params.action ?? (params.refundCents > 0 ? "refund" : "no_refund");
  const when = params.startsAt ? ` on ${formatChicago(params.startsAt)}` : "";
  const message =
    action === "release_hold"
      ? `Your booking request for ${params.roomName}${when} has been cancelled, and the hold on your card has been released. You were not charged.`
      : action === "refund" && params.refundCents > 0
        ? `Your booking for ${params.roomName}${when} has been cancelled. A full refund of ${formatMoney(
            params.refundCents
          )} is on its way back to your card (usually 5–10 business days).`
        : `Your booking for ${params.roomName}${when} has been cancelled. No refund is due, because it was cancelled less than 48 hours before the start time.`;
  return {
    subject,
    html: emailLayout({ title: "Booking cancelled", bodyHtml: paragraphHtml(message) }),
    text: message,
  };
}

export function renderBookingExpiredEmail(params: { roomName: string }): RenderedEmail {
  const subject = `Booking request expired — ${params.roomName}`;
  const message = `Staff did not respond to your request for ${params.roomName} within 24 hours, so it has automatically expired and the hold on your card has been released. You were not charged.`;
  return {
    subject,
    html: emailLayout({ title: "Booking request expired", bodyHtml: paragraphHtml(message) }),
    text: message,
  };
}

export interface HostNewRequestParams extends BookingEmailParams {
  guestName: string;
  guestEmail: string;
  /** Auto-decline deadline; shown prominently at the top of the email. */
  hostActionDeadlineAt?: string;
}

function deadlineBannerHtml(text: string, url: string): string {
  return `<div style="margin:0 0 18px;padding:14px 16px;border:2px solid ${COPPER};border-radius:10px;background:#fff7ef;">
      <p style="margin:0 0 6px;font-size:16px;line-height:1.4;font-weight:700;color:${COPPER};">${escapeHtml(text)}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:${NAVY};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open host queue</a>
    </div>`;
}

function deadlineLine(deadlineIso: string | undefined): string {
  return deadlineIso
    ? `ACTION NEEDED: accept or decline by ${formatChicago(deadlineIso)} (Central) or it auto-declines and the hold is released.`
    : "ACTION NEEDED: accept or decline within 24 hours or it auto-declines and the hold is released.";
}

export function renderHostNewRequestEmail(params: HostNewRequestParams): RenderedEmail {
  const subject = newRequestSubject({ ...params });
  const queueUrl = hostQueueUrl();
  const banner = deadlineLine(params.hostActionDeadlineAt);
  const rows = [
    { label: "Guest", value: params.guestName },
    { label: "Email", value: params.guestEmail },
    ...summaryRows(params),
  ];
  const bodyHtml = `
    ${deadlineBannerHtml(banner, queueUrl)}
    ${paragraphHtml(`A new booking request came in for ${params.roomName}.`)}
    ${summaryTableHtml(rows)}
  `;
  const text = [
    banner,
    `Host queue: ${queueUrl}`,
    "",
    `A new booking request came in for ${params.roomName}.`,
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
  ].join("\n");
  return { subject, html: emailLayout({ title: "New booking request", bodyHtml }), text };
}

export function renderHostDecisionReminderEmail(params: HostNewRequestParams & { hoursLabel: string }): RenderedEmail {
  const subject = reminderSubject({ ...params }, params.hoursLabel);
  const queueUrl = hostQueueUrl();
  const banner = `REMINDER: this request auto-declines in ${params.hoursLabel}${params.hostActionDeadlineAt ? ` (${formatChicago(params.hostActionDeadlineAt)} Central)` : ""}. Accept or decline now.`;
  const rows = [
    { label: "Guest", value: params.guestName },
    { label: "Email", value: params.guestEmail },
    ...summaryRows(params),
  ];
  const bodyHtml = `${deadlineBannerHtml(banner, queueUrl)}${summaryTableHtml(rows)}`;
  const text = [banner, `Host queue: ${queueUrl}`, "", ...rows.map((r) => `${r.label}: ${r.value}`)].join("\n");
  return { subject, html: emailLayout({ title: "Booking request reminder", bodyHtml }), text };
}

export interface HostBookingCancelledParams extends BookingEmailParams {
  guestName: string;
  guestEmail: string;
  refundCents: number;
  action: "release_hold" | "refund" | "no_refund";
  cancelledBy: "guest" | "staff";
  courtesy?: boolean;
}

export function renderHostBookingCancelledEmail(params: HostBookingCancelledParams): RenderedEmail {
  const who = params.cancelledBy === "guest" ? "the guest" : "staff";
  const subject = cancelledSubject({ ...params });
  const outcome =
    params.action === "release_hold"
      ? "Card hold released (never charged)"
      : params.action === "refund"
        ? `Refunded ${formatMoney(params.refundCents)}${params.courtesy ? " (courtesy override)" : ""}`
        : "No refund (inside 48h)";
  const rows = [
    { label: "Guest", value: params.guestName },
    { label: "Email", value: params.guestEmail },
    { label: "Room", value: params.roomName },
    { label: "Starts", value: formatChicago(params.startsAt) },
    { label: "Ends", value: formatChicago(params.endsAt) },
    { label: "Booking total", value: formatMoney(params.totalCents) },
    { label: "Payment", value: outcome, highlight: true },
    { label: "Booking ID", value: params.bookingId },
  ];
  const intro = `A booking for ${params.roomName} was cancelled by ${who}. The calendar slot has been freed.`;
  const bodyHtml = `${paragraphHtml(intro)}${summaryTableHtml(rows)}`;
  const text = [intro, "", ...rows.map((r) => `${r.label}: ${r.value}`)].join("\n");
  return { subject, html: emailLayout({ title: "Booking cancelled", bodyHtml }), text };
}

// ---- Parking pass recipients ------------------------------------------------------------------

export const PARKING_NO_MARKETING_TEXT =
  "We only use these details to send parking passes for this booking. They won't be used for marketing.";
export const PARKING_QR_TEXT =
  "Each person on the list will receive a QR code by text or email. They scan it at the gate when they drive in.";

function passWord(n: number) {
  return `${n} parking pass${n === 1 ? "" : "es"}`;
}

export function renderParkingRecipientsRequestEmail(params: {
  roomName: string;
  startsAt: string;
  endsAt: string;
  parkingPasses: number;
  url: string;
  reminder?: boolean;
}): RenderedEmail {
  const subject = params.reminder
    ? `Reminder: who's using your parking passes? — ${params.roomName}`
    : `Parking passes: tell us who's coming — ${params.roomName}`;
  const intro = params.reminder
    ? `Your booking for ${params.roomName} is coming up, and we still don't know who's using your ${passWord(params.parkingPasses)}.`
    : `Thanks for booking ${params.roomName}. Your booking includes ${passWord(params.parkingPasses)}.`;
  const ask =
    "Please send us the mobile number or email of each person who will get a parking pass. It only takes a minute.";
  const rows = [
    { label: "Room", value: params.roomName },
    { label: "Starts", value: formatChicago(params.startsAt) },
    { label: "Ends", value: formatChicago(params.endsAt) },
    { label: "Parking passes", value: String(params.parkingPasses), highlight: true },
  ];
  const bullets = [PARKING_QR_TEXT, PARKING_ENTRANCE_TEXT, PARKING_NO_MARKETING_TEXT];
  const bodyHtml = `
    ${paragraphHtml(intro)}
    ${paragraphHtml(ask)}
    ${buttonHtml(params.url, "Add parking pass holders")}
    ${summaryTableHtml(rows)}
    <h2 style="margin:20px 0 10px;font-family:${FONT_DISPLAY};font-weight:400;font-size:16px;color:${NAVY};">Good to know</h2>
    ${listHtml(bullets)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:${STONE_LIGHT};">You can update the list until your booking starts. Questions? ${escapeHtml(CONTACT_NAME)}, ${escapeHtml(CONTACT_PHONE_DISPLAY)}, or stop by ${escapeHtml(CONTACT_SUITE)}.</p>
  `;
  const text = [
    intro,
    "",
    ask,
    `Add parking pass holders: ${params.url}`,
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    "",
    ...bullets.map((b) => `- ${b}`),
    "",
    `You can update the list until your booking starts. Questions? ${CONTACT_NAME}, ${CONTACT_PHONE_DISPLAY}, or stop by ${CONTACT_SUITE}.`,
  ].join("\n");
  return {
    subject,
    html: emailLayout({ title: params.reminder ? "Who's using your parking passes?" : "Who's getting a parking pass?", bodyHtml }),
    text,
  };
}

export function renderHostParkingRecipientsEmail(params: {
  roomName: string;
  startsAt: string;
  endsAt: string;
  parkingPasses: number;
  guestName: string;
  guestEmail: string;
  bookingId: string;
  recipients: { phone?: string; email?: string }[];
}): RenderedEmail {
  const subject = `Parking passes to issue: ${params.recipients.length} of ${params.parkingPasses} — ${params.roomName}, ${shortDateRange(params.startsAt, params.endsAt)}`;
  const intro = `${params.guestName} sent the parking pass list for their ${params.roomName} booking. Issue a gate QR code in Parkonect for each mobile number or email below.`;
  const rows = [
    { label: "Guest", value: params.guestName },
    { label: "Email", value: params.guestEmail },
    { label: "Room", value: params.roomName },
    { label: "Starts", value: formatChicago(params.startsAt) },
    { label: "Ends", value: formatChicago(params.endsAt) },
    { label: "Passes booked", value: String(params.parkingPasses) },
    { label: "Booking ID", value: params.bookingId },
  ];
  const lines = params.recipients.map(
    (r, i) => `${i + 1}. ${r.phone || r.email || ""}`
  );
  const bodyHtml = `${paragraphHtml(intro)}${summaryTableHtml(rows)}
    <h2 style="margin:20px 0 10px;font-family:${FONT_DISPLAY};font-weight:400;font-size:16px;color:${NAVY};">Pass holders</h2>
    ${listHtml(lines)}
    ${paragraphHtml("If the guest updates the list, you'll get another email with the full new list.")}`;
  const text = [intro, "", ...rows.map((r) => `${r.label}: ${r.value}`), "", "Pass holders:", ...lines].join("\n");
  return { subject, html: emailLayout({ title: "Parking pass list received", bodyHtml }), text };
}

export function renderHostParkingStatusEmail(params: {
  roomName: string;
  startsAt: string;
  endsAt: string;
  parkingPasses: number;
  guestName: string;
  guestEmail: string;
  bookingId: string;
  recipients: { phone?: string; email?: string }[];
  issuedAt?: string;
  issuedBy?: string;
  issuedNote?: string;
}): RenderedEmail {
  const issued = Boolean(params.issuedAt);
  const status = issued ? "ISSUED" : "NOT ISSUED";
  const subject = `Parking passes ${status} — ${params.roomName}, ${shortDateRange(params.startsAt, params.endsAt)} (${params.parkingPasses} pass${params.parkingPasses === 1 ? "" : "es"})`;
  const intro = issued
    ? `Parking passes for this booking were marked issued in Parkonect. It starts within 24 hours.`
    : `Parking passes for this booking have NOT been marked issued yet, and it starts within 24 hours. Issue them in Parkonect, then mark them issued on the host page.`;
  const rows: { label: string; value: string; highlight?: boolean }[] = [
    { label: "Status", value: status, highlight: true },
    ...(issued ? [{ label: "Marked issued", value: `${formatChicago(params.issuedAt!)}${params.issuedBy ? ` by ${params.issuedBy}` : ""}` }] : []),
    ...(params.issuedNote ? [{ label: "Note", value: params.issuedNote }] : []),
    { label: "Guest", value: params.guestName },
    { label: "Email", value: params.guestEmail },
    { label: "Room", value: params.roomName },
    { label: "Starts", value: formatChicago(params.startsAt) },
    { label: "Ends", value: formatChicago(params.endsAt) },
    { label: "Passes booked", value: String(params.parkingPasses) },
    { label: "Pass holders submitted", value: `${params.recipients.length} of ${params.parkingPasses}` },
    { label: "Booking ID", value: params.bookingId },
  ];
  const lines = params.recipients.length
    ? params.recipients.map((r, i) => `${i + 1}. ${r.phone || r.email || ""}`)
    : ["Guest has not submitted names yet (no mobile numbers or emails)."];
  const queueUrl = hostQueueUrl();
  const bodyHtml = `${paragraphHtml(intro)}${summaryTableHtml(rows)}
    <h2 style="margin:20px 0 10px;font-family:${FONT_DISPLAY};font-weight:400;font-size:16px;color:${NAVY};">Pass holders</h2>
    ${listHtml(lines)}
    ${buttonHtml(queueUrl, "Open host page")}`;
  const text = [intro, "", ...rows.map((r) => `${r.label}: ${r.value}`), "", "Pass holders:", ...lines, "", `Host page: ${queueUrl}`].join("\n");
  return { subject, html: emailLayout({ title: `Parking passes ${status.toLowerCase()}`, bodyHtml }), text };
}

export interface FeedbackEmailParams {
  roomName: string;
  startsAt: string;
  endsAt: string;
  url: string;
}

export function renderFeedbackRequestEmail(p: FeedbackEmailParams): RenderedEmail {
  const intro = `Thanks for choosing Cue. How was your experience in ${p.roomName}?`;
  const buttons = [1, 2, 3, 4, 5].map((rating) =>
    `<a href="${escapeHtml(`${p.url}&r=${rating}`)}" aria-label="Rate ${rating} out of 5" style="display:inline-block;margin:0 8px 8px 0;padding:12px 17px;background:${NAVY};color:#fff;border-radius:6px;font-family:${FONT_SANS};font-size:18px;text-decoration:none;">${rating}</a>`
  ).join("");
  return {
    subject: "How was your time at Cue?",
    html: emailLayout({ title: "How did we do?", realLogo: true, bodyHtml:
      paragraphHtml(intro) + summaryTableHtml([{ label: "Your visit", value: shortDateRange(p.startsAt, p.endsAt) }]) +
      paragraphHtml("Choose a rating below — 1 is poor, 5 is excellent. You can add a comment on the next page.") +
      `<div style="margin:20px 0 4px;">${buttons}</div>` + paragraphHtml("Your feedback helps us make the next visit better. Thank you, from all of us at Cue.") }),
    text: [intro, shortDateRange(p.startsAt, p.endsAt), "1 is poor; 5 is excellent. Add an optional comment after choosing.",
      ...[1,2,3,4,5].map((r) => `${r}/5: ${p.url}&r=${r}`), "Thank you, from all of us at Cue."].join("\n\n"),
  };
}

export function renderHostFeedbackEmail(p: FeedbackEmailParams & { rating: number; comment: string; bookingId: string }): RenderedEmail {
  const subject = `${p.rating <= 2 ? "ACTION NEEDED — " : ""}Cue feedback: ${p.rating}/5 · ${p.roomName}`;
  const when = shortDateRange(p.startsAt, p.endsAt);
  return {
    subject,
    html: emailLayout({ title: subject, realLogo: true, bodyHtml:
      summaryTableHtml([{ label: "Room", value: p.roomName }, { label: "Visit", value: when }, { label: "Rating", value: `${p.rating}/5` }]) +
      `<div style="white-space:pre-wrap;">${paragraphHtml(p.comment || "No comment added.")}</div>` + paragraphHtml(`Booking: ${p.bookingId}`) }),
    text: `${p.roomName}\n${when}\nRating: ${p.rating}/5\n\n${p.comment || "No comment added."}\n\nBooking: ${p.bookingId}`,
  };
}
