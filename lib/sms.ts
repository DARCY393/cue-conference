/**
 * Host alert texts via Twilio's Messages REST API (plain fetch, no SDK).
 *
 * Config (server env only, never the repo): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * TWILIO_MESSAGING_SERVICE_SID (or TWILIO_PHONE_NUMBER as the From number) and
 * HOST_ALERT_SMS_TO (comma list, E.164). Anything missing => logged no-op.
 * Never throws: a text failing must not break the booking flow. Logs mask numbers to the last 4.
 */
import { emailSubjectPrefix } from "./email";
import { recordDelivery } from "./delivery-log";

export interface SmsSender {
  /** Returns the provider message id (Twilio SID) when known. */
  send(to: string, body: string): Promise<string | void>;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `***${digits.slice(-4)}`;
}

/** Comma/semicolon/space separated list -> trimmed, de-duplicated, E.164-looking numbers only. */
export function parseSmsRecipients(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw || "").split(/[,;\s]+/)) {
    const n = part.trim();
    if (/^\+[1-9]\d{7,14}$/.test(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  from?: string;
}

function twilioConfig(): TwilioConfig | null {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim() || undefined;
  const from = (process.env.TWILIO_PHONE_NUMBER || "").trim() || undefined;
  if (!accountSid || !authToken || (!messagingServiceSid && !from)) return null;
  return { accountSid, authToken, messagingServiceSid, from };
}

class TwilioSmsSender implements SmsSender {
  constructor(private cfg: TwilioConfig) {}
  async send(to: string, body: string): Promise<string | void> {
    const form = new URLSearchParams({ To: to, Body: body });
    if (this.cfg.messagingServiceSid) form.set("MessagingServiceSid", this.cfg.messagingServiceSid);
    else if (this.cfg.from) form.set("From", this.cfg.from);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }
    );
    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { code?: number; message?: string };
        detail = `${j.code ?? ""} ${j.message ?? ""}`.trim();
      } catch {
        /* ignore */
      }
      throw new Error(`Twilio HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    try {
      const j = (await res.json()) as { sid?: string };
      return j.sid;
    } catch {
      return undefined;
    }
  }
}

let overrideSender: SmsSender | null = null;
/** Test hook. Pass null to resume env-based selection. */
export function setSmsSender(s: SmsSender | null) {
  overrideSender = s;
}

export function smsPrefix(): string {
  return emailSubjectPrefix() ? "[PREVIEW] " : "";
}

/** Text every HOST_ALERT_SMS_TO number. Returns how many sends succeeded. Never throws. */
export async function sendHostSms(body: string, kind: string, bookingId?: string): Promise<number> {
  try {
    const recipients = parseSmsRecipients(process.env.HOST_ALERT_SMS_TO);
    const cfg = twilioConfig();
    const sender = overrideSender ?? (cfg ? new TwilioSmsSender(cfg) : null);
    if (!sender || recipients.length === 0) {
      const reason = !sender ? "Twilio not configured" : "HOST_ALERT_SMS_TO not set";
      console.log(`[sms] skipped ${kind}: ${reason}`);
      for (const to of recipients.length ? recipients : [""]) {
        await recordDelivery({ bookingId, channel: "sms", kind, recipient: to, status: "skipped", error: reason });
      }
      return 0;
    }
    const text = `${smsPrefix()}${body}`;
    let ok = 0;
    for (const to of recipients) {
      try {
        const sid = await sender.send(to, text);
        ok++;
        console.log(`[sms] sent ${kind} to ${maskPhone(to)}`);
        await recordDelivery({ bookingId, channel: "sms", kind, recipient: to, status: "sent", providerId: sid || null });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[sms] send failed ${kind} to ${maskPhone(to)}: ${error}`);
        await recordDelivery({ bookingId, channel: "sms", kind, recipient: to, status: "failed", error });
      }
    }
    return ok;
  } catch (err) {
    console.error(`[sms] send failed ${kind}: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
