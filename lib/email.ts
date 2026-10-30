import { recordDelivery } from "./delivery-log";

export interface EmailMessage {
  to: string;
  template: string;
  subject: string;
  payload?: Record<string, unknown>;
  html?: string;
  text?: string;
  replyTo?: string;
  /** For the delivery log only; not sent. */
  bookingId?: string;
}

/** What a sender reports back. Older/test senders may return nothing (treated as sent). */
export interface EmailSendResult {
  status: "sent" | "failed" | "skipped";
  messageId?: string;
  error?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult | void>;
}

/** Fallback when SMTP isn't configured — logs metadata only, never the full HTML body. */
export class ConsoleEmailLogger implements EmailSender {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.log(
      JSON.stringify({
        channel: "email",
        at: new Date().toISOString(),
        to: message.to,
        subject: message.subject,
        template: message.template,
        replyTo: message.replyTo,
      })
    );
    return { status: "skipped", error: "SMTP not configured" };
  }
}

function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.EMAIL_FROM
  );
}

/** Real SMTP sender (nodemailer). Never throws — failures are caught and logged so a flaky
 * mail server can't break the booking flow. */
export class SmtpEmailSender implements EmailSender {
  private transporter: ReturnType<typeof import("nodemailer")["createTransport"]> | null = null;

  private async getTransporter() {
    if (!this.transporter) {
      const nodemailer = await import("nodemailer");
      const port = Number(process.env.SMTP_PORT);
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const transporter = await this.getTransporter();
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
      });
      return { status: "sent", messageId: info?.messageId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error("[email] send failed", {
        to: message.to,
        subject: message.subject,
        template: message.template,
        error,
      });
      return { status: "failed", error };
    }
  }
}

let overrideSender: EmailSender | null = null;
const consoleLogger = new ConsoleEmailLogger();
let smtpSender: SmtpEmailSender | null = null;

export const PREVIEW_SUBJECT_PREFIX = "[PREVIEW] ";

/**
 * Subject prefix for this deployment: "[PREVIEW] " when CUE_APP_ENV=preview, otherwise none
 * (live and unset are unchanged). Lets staff tell preview test mail from real bookings.
 */
export function emailSubjectPrefix(): string {
  return (process.env.CUE_APP_ENV || "").trim().toLowerCase() === "preview" ? PREVIEW_SUBJECT_PREFIX : "";
}

export function applySubjectPrefix(subject: string, prefix: string = emailSubjectPrefix()): string {
  if (!prefix || subject.startsWith(prefix)) return subject;
  return `${prefix}${subject}`;
}

function baseSender(): EmailSender {
  if (overrideSender) return overrideSender;
  if (smtpConfigured()) {
    if (!smtpSender) smtpSender = new SmtpEmailSender();
    return smtpSender;
  }
  return consoleLogger;
}

/** Every outgoing email goes through here, so the preview prefix applies to all of them. */
export function getEmailSender(): EmailSender {
  const sender = baseSender();
  const prefix = emailSubjectPrefix();
  return {
    send: async (message: EmailMessage): Promise<EmailSendResult> => {
      const out = prefix ? { ...message, subject: applySubjectPrefix(message.subject, prefix) } : message;
      let result: EmailSendResult;
      try {
        result = (await sender.send(out)) || { status: "sent" };
      } catch (err) {
        result = { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
      await recordDelivery({
        bookingId: message.bookingId,
        channel: "email",
        kind: message.template,
        recipient: message.to,
        status: result.status,
        providerId: result.messageId,
        error: result.error,
      });
      return result;
    },
  };
}

/** Test/override hook. Pass undefined/null to clear the override and resume env-based selection. */
export function setEmailSender(s: EmailSender | null) {
  overrideSender = s;
}
