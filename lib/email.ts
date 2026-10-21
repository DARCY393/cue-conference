export interface EmailMessage {
  to: string;
  template: string;
  subject: string;
  payload?: Record<string, unknown>;
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Fallback when SMTP isn't configured — logs metadata only, never the full HTML body. */
export class ConsoleEmailLogger implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
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

  async send(message: EmailMessage): Promise<void> {
    try {
      const transporter = await this.getTransporter();
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
      });
    } catch (err) {
      console.error("[email] send failed", {
        to: message.to,
        subject: message.subject,
        template: message.template,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

let overrideSender: EmailSender | null = null;
const consoleLogger = new ConsoleEmailLogger();
let smtpSender: SmtpEmailSender | null = null;

export function getEmailSender(): EmailSender {
  if (overrideSender) return overrideSender;
  if (smtpConfigured()) {
    if (!smtpSender) smtpSender = new SmtpEmailSender();
    return smtpSender;
  }
  return consoleLogger;
}

/** Test/override hook. Pass undefined/null to clear the override and resume env-based selection. */
export function setEmailSender(s: EmailSender | null) {
  overrideSender = s;
}
