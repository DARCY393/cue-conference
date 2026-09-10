export interface EmailMessage {
  to: string;
  template: string;
  subject: string;
  payload?: Record<string, unknown>;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** MVP: log emails to the console. */
export class ConsoleEmailLogger implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      JSON.stringify({
        channel: "email",
        at: new Date().toISOString(),
        ...message,
      })
    );
  }
}

let sender: EmailSender = new ConsoleEmailLogger();

export function getEmailSender(): EmailSender {
  return sender;
}

export function setEmailSender(s: EmailSender) {
  sender = s;
}
