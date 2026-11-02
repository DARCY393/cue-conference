/**
 * "Ask a question" inquiries: validate, spam-check, rate-limit, store, and email the host list
 * (Reply-To = asker) plus a short acknowledgement to the asker. Never texts.
 */
import { hasDatabase, query } from "./db";
import { isDemoMode } from "./store";
import { getEmailSender } from "./email";
import { isValidEmail } from "./validate";
import { getSpaceBySlug } from "./space-service";
import {
  MAX_MESSAGE_CHARS,
  hashIp,
  localVerdict,
  verifyTurnstile,
  type SpamVerdict,
} from "./inquiry-spam";

export const RATE_PER_HOUR = 3;
export const RATE_PER_DAY = 10;

export interface InquiryInput {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  roomSlug?: unknown;
  preferredDate?: unknown;
  message?: unknown;
  website?: unknown; // honeypot
  formToken?: unknown;
  turnstileToken?: unknown;
}

export interface InquiryRow {
  id: string;
  spaceSlug: string | null;
  spaceTitle: string | null;
  name: string;
  email: string;
  phone: string | null;
  preferredDate: string | null;
  message: string;
  ipHash: string;
  spamVerdict: SpamVerdict;
  createdAt: string;
}

export type InquiryResult =
  | { kind: "accepted"; verdict: SpamVerdict } // real or silently-dropped spam: both look like success
  | { kind: "invalid"; message: string }
  | { kind: "rate_limited" };

/** Demo-mode (no DB) storage. */
const memory: InquiryRow[] = [];
export function _resetInquiries(): void {
  memory.length = 0;
}

function dbBacked(): boolean {
  return hasDatabase() && !isDemoMode();
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function recentCounts(ipHash: string, email: string): Promise<{ ipHour: number; ipDay: number; emHour: number; emDay: number }> {
  const hourAgo = Date.now() - 3600_000;
  const dayAgo = Date.now() - 86_400_000;
  if (!dbBacked()) {
    const t = (r: InquiryRow) => Date.parse(r.createdAt);
    const ip = memory.filter((r) => r.ipHash === ipHash);
    const em = memory.filter((r) => r.email.toLowerCase() === email);
    return {
      ipHour: ip.filter((r) => t(r) > hourAgo).length,
      ipDay: ip.filter((r) => t(r) > dayAgo).length,
      emHour: em.filter((r) => t(r) > hourAgo).length,
      emDay: em.filter((r) => t(r) > dayAgo).length,
    };
  }
  // Rate-limited attempts aren't counted, so a blocked sender's window still expires.
  const { rows } = await query<{ ip_hour: string; ip_day: string; em_hour: string; em_day: string }>(
    `SELECT
       count(*) FILTER (WHERE ip_hash = $1 AND created_at > now() - interval '1 hour') AS ip_hour,
       count(*) FILTER (WHERE ip_hash = $1) AS ip_day,
       count(*) FILTER (WHERE lower(email) = $2 AND created_at > now() - interval '1 hour') AS em_hour,
       count(*) FILTER (WHERE lower(email) = $2) AS em_day
     FROM inquiries
     WHERE created_at > now() - interval '1 day' AND spam_verdict <> 'rate_limited'
       AND (ip_hash = $1 OR lower(email) = $2)`,
    [ipHash, email]
  );
  const r = rows[0];
  return { ipHour: Number(r?.ip_hour ?? 0), ipDay: Number(r?.ip_day ?? 0), emHour: Number(r?.em_hour ?? 0), emDay: Number(r?.em_day ?? 0) };
}

async function store(row: Omit<InquiryRow, "id" | "createdAt">): Promise<InquiryRow> {
  if (!dbBacked()) {
    const full: InquiryRow = { ...row, id: `inq-${memory.length + 1}`, createdAt: new Date().toISOString() };
    memory.push(full);
    return full;
  }
  const { rows } = await query<{ id: string; created_at: Date }>(
    `INSERT INTO inquiries (space_slug, space_title, name, email, phone, preferred_date, message, ip_hash, spam_verdict)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
    [row.spaceSlug, row.spaceTitle, row.name, row.email, row.phone, row.preferredDate, row.message, row.ipHash, row.spamVerdict]
  );
  return { ...row, id: rows[0].id, createdAt: new Date(rows[0].created_at).toISOString() };
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function prettyDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function inquirySubject(roomTitle: string | null, name: string): string {
  return `Question about ${roomTitle || "The Cue conference rooms"} — ${name}`;
}

function hostBody(r: InquiryRow): { text: string; html: string } {
  const lines: [string, string | null][] = [
    ["Name", r.name],
    ["Email", r.email],
    ["Phone", r.phone],
    ["Room", r.spaceTitle],
    ["Preferred date", prettyDate(r.preferredDate)],
  ];
  const kept = lines.filter((l): l is [string, string] => Boolean(l[1]));
  const text = [
    ...kept.map(([k, v]) => `${k}: ${v}`),
    "",
    r.message,
    "",
    "Hit Reply to answer — it goes straight to the guest.",
  ].join("\n");
  const html = `<div style="font-family:'Public Sans',Arial,sans-serif;color:#213953;font-size:14px;line-height:1.5">
${kept.map(([k, v]) => `<p style="margin:0 0 4px"><strong>${k}:</strong> ${escapeHtml(v)}</p>`).join("\n")}
<p style="white-space:pre-wrap;margin:16px 0;padding:12px 16px;border-left:3px solid #B5651D;background:#f7f5f2">${escapeHtml(r.message)}</p>
<p style="color:#6b6b6b;font-size:12px">Hit Reply to answer — it goes straight to the guest.</p></div>`;
  return { text, html };
}

function ackBody(r: InquiryRow): { text: string; html: string } {
  const room = r.spaceTitle ? ` about the ${r.spaceTitle}` : "";
  const intro = `Hi ${r.name.split(/\s+/)[0]},\n\nThanks for your question${room}. We'll reply by email, usually within a business day.`;
  const text = `${intro}\n\nYour message:\n${r.message}\n\n— The Cue`;
  const html = `<div style="font-family:'Public Sans',Arial,sans-serif;color:#213953;font-size:14px;line-height:1.5">
<p>${escapeHtml(intro).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>
<p style="margin:0 0 4px;color:#6b6b6b">Your message:</p>
<p style="white-space:pre-wrap;margin:0 0 16px;padding:12px 16px;border-left:3px solid #B5651D;background:#f7f5f2">${escapeHtml(r.message)}</p>
<p>— The Cue</p></div>`;
  return { text, html };
}

export async function submitInquiry(input: InquiryInput, ip: string): Promise<InquiryResult> {
  const name = str(input.name, 100);
  const email = str(input.email, 200);
  const phone = str(input.phone, 40) || null;
  const rawMessage = typeof input.message === "string" ? input.message.trim() : "";
  const roomSlug = str(input.roomSlug, 80);
  const preferredRaw = str(input.preferredDate, 10);

  if (!name || !email || !rawMessage) return { kind: "invalid", message: "Name, email and your question are required." };
  if (!isValidEmail(email)) return { kind: "invalid", message: "Enter a valid email address." };
  if (rawMessage.length > MAX_MESSAGE_CHARS) {
    return { kind: "invalid", message: `Please keep your question under ${MAX_MESSAGE_CHARS} characters.` };
  }
  if (phone && !/^[0-9+().\-\s x]{7,40}$/i.test(phone)) return { kind: "invalid", message: "Enter a valid phone number, or leave it blank." };
  const preferredDate = /^\d{4}-\d{2}-\d{2}$/.test(preferredRaw) && !Number.isNaN(Date.parse(preferredRaw)) ? preferredRaw : null;

  const space = roomSlug ? await getSpaceBySlug(roomSlug).catch(() => null) : null;
  const ipHash = hashIp(ip);
  const base = {
    spaceSlug: space?.slug ?? null,
    spaceTitle: space?.title ?? null,
    name,
    email,
    phone,
    preferredDate,
    message: rawMessage,
    ipHash,
  };

  let verdict = localVerdict({ honeypot: input.website, formToken: input.formToken, text: `${name}\n${rawMessage}` });
  if (verdict === "ok" && !(await verifyTurnstile(input.turnstileToken, ip))) verdict = "turnstile_failed";

  if (verdict === "ok") {
    const c = await recentCounts(ipHash, email.toLowerCase());
    if (c.ipHour >= RATE_PER_HOUR || c.emHour >= RATE_PER_HOUR || c.ipDay >= RATE_PER_DAY || c.emDay >= RATE_PER_DAY) {
      await store({ ...base, spamVerdict: "rate_limited" });
      console.log(`[inquiry] rate_limited room=${base.spaceSlug ?? "-"}`);
      return { kind: "rate_limited" };
    }
  }

  const row = await store({ ...base, spamVerdict: verdict });
  console.log(`[inquiry] ${row.id} verdict=${verdict} room=${row.spaceSlug ?? "-"}`);
  if (verdict !== "ok") return { kind: "accepted", verdict }; // bots see success; nothing is sent

  const sender = getEmailSender();
  const host = hostBody(row);
  await sender.send({
    to: process.env.HOST_EMAIL || "host@example.com",
    template: "host_inquiry",
    subject: inquirySubject(row.spaceTitle, row.name),
    text: host.text,
    html: host.html,
    replyTo: row.email,
  });
  const ack = ackBody(row);
  await sender.send({
    to: row.email,
    template: "inquiry_ack",
    subject: `We got your question${row.spaceTitle ? ` about the ${row.spaceTitle}` : ""}`,
    text: ack.text,
    html: ack.html,
    replyTo: (process.env.HOST_EMAIL || "").split(",")[0]?.trim() || undefined,
  });
  return { kind: "accepted", verdict };
}

export async function listInquiries(limit = 100): Promise<InquiryRow[]> {
  if (!dbBacked()) return [...memory].reverse().slice(0, limit);
  const { rows } = await query<Record<string, unknown>>(
    `SELECT id, space_slug, space_title, name, email, phone, to_char(preferred_date,'YYYY-MM-DD') AS preferred_date,
            message, ip_hash, spam_verdict, created_at
     FROM inquiries ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    spaceSlug: (r.space_slug as string) ?? null,
    spaceTitle: (r.space_title as string) ?? null,
    name: String(r.name),
    email: String(r.email),
    phone: (r.phone as string) ?? null,
    preferredDate: (r.preferred_date as string) ?? null,
    message: String(r.message),
    ipHash: String(r.ip_hash),
    spamVerdict: r.spam_verdict as SpamVerdict,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}
