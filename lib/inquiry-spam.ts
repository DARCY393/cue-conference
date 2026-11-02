/**
 * Spam checks for the "Ask a question" form. All invisible to real people:
 * honeypot, signed form-age token (min time-to-submit), link/keyword checks, optional Turnstile.
 * Rate limiting lives in lib/inquiries.ts (it needs the DB).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MIN_SUBMIT_MS = 3000;
/** A form token older than this is stale (the page sat open for a day); ask to resend. */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_LINKS = 2;
export const MAX_MESSAGE_CHARS = 2000;

export type SpamVerdict =
  | "ok"
  | "honeypot"
  | "too_fast"
  | "bad_token"
  | "too_many_links"
  | "shortener"
  | "keywords"
  | "turnstile_failed"
  | "rate_limited";

function secret(): string {
  return (
    process.env.INQUIRY_FORM_SECRET ||
    createHash("sha256").update(`cue-inquiry:${process.env.DATABASE_URL || "dev"}`).digest("hex")
  );
}

function sign(ts: string): string {
  return createHmac("sha256", secret()).update(`inquiry-form:${ts}`).digest("hex").slice(0, 32);
}

/** Issued when the form opens; the server checks how long ago on submit. Bots can't forge it. */
export function issueFormToken(now = Date.now()): string {
  const ts = String(now);
  return `${ts}.${sign(ts)}`;
}

/** Milliseconds since the token was issued, or null if missing/forged. */
export function formTokenAgeMs(token: unknown, now = Date.now()): number | null {
  if (typeof token !== "string") return null;
  const [ts, sig] = token.split(".");
  if (!ts || !sig || !/^\d{10,16}$/.test(ts)) return null;
  const expected = sign(ts);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return now - Number(ts);
}

export function hashIp(ip: string): string {
  return createHmac("sha256", secret()).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|(?<![@\w.-])[a-z0-9-]+\.(?:com|net|org|io|ru|cn|xyz|top|info|biz|co|ly|me|link|site|online|shop)(?:\/\S*)?\b/gi;

export function countLinks(text: string): number {
  return (text.match(URL_RE) || []).length;
}

const SHORTENERS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly",
  "cutt.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "s.id", "lnkd.in",
];

const SPAM_KEYWORDS = [
  /\bseo\b/i, /backlinks?/i, /\bcrypto(currency)?\b/i, /\bbitcoin\b/i, /\bcasino\b/i,
  /\bviagra\b/i, /\bcialis\b/i, /\bloan offer\b/i, /\bforex\b/i, /\bweb ?design services?\b/i,
  /\brank (your|on) google\b/i, /\bguest post\b/i, /\bwhatsapp me\b/i, /\btelegram\b/i,
];

export function contentVerdict(text: string): SpamVerdict {
  const lower = text.toLowerCase();
  if (SHORTENERS.some((s) => new RegExp(`(^|[^a-z0-9.-])${s.replace(/\./g, "\\.")}/`, "i").test(lower))) {
    return "shortener";
  }
  if (countLinks(text) > MAX_LINKS) return "too_many_links";
  if (SPAM_KEYWORDS.some((re) => re.test(text))) return "keywords";
  return "ok";
}

export interface FormSignals {
  honeypot?: unknown;
  formToken?: unknown;
  text: string;
}

/** Cheap, local checks in order. Returns the first failing verdict, or "ok". */
export function localVerdict(s: FormSignals, now = Date.now()): SpamVerdict {
  if (typeof s.honeypot === "string" && s.honeypot.trim() !== "") return "honeypot";
  const age = formTokenAgeMs(s.formToken, now);
  if (age === null || age < 0 || age > MAX_FORM_AGE_MS) return "bad_token";
  if (age < MIN_SUBMIT_MS) return "too_fast";
  return contentVerdict(s.text);
}

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}

/** Server-side Turnstile check. Returns true when Turnstile isn't configured. */
export async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (typeof token !== "string" || !token) return false;
  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY as string,
      response: token,
      remoteip: ip,
    });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Cloudflare unreachable: fail open; the other checks still apply.
    return true;
  }
}
