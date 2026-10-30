/**
 * Delivery log: one message_logs row + one console line per email/text attempt.
 * Never throws — logging must not break a booking flow.
 */
import { hasDatabase, query } from "./db";
import { isDemoMode } from "./store";

export type DeliveryChannel = "email" | "sms";
export type DeliveryStatus = "sent" | "failed" | "skipped";

export interface DeliveryRecord {
  bookingId?: string | null;
  channel: DeliveryChannel;
  kind: string;
  recipient: string;
  status: DeliveryStatus;
  providerId?: string | null;
  error?: string | null;
}

export function maskRecipient(channel: DeliveryChannel, recipient: string): string {
  if (channel === "email") return recipient;
  const digits = recipient.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `***${digits.slice(-4)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordDelivery(rec: DeliveryRecord): Promise<void> {
  try {
    const to = maskRecipient(rec.channel, rec.recipient || "");
    const err = rec.error ? String(rec.error).slice(0, 500) : null;
    console.log(
      `[delivery] ${rec.channel} ${rec.kind} ${rec.status} to=${to}` +
        (rec.bookingId ? ` booking=${rec.bookingId}` : "") +
        (rec.providerId ? ` id=${rec.providerId}` : "") +
        (err ? ` error=${err}` : "")
    );
    if (!hasDatabase() || isDemoMode()) return;
    const bookingId = rec.bookingId && UUID_RE.test(rec.bookingId) ? rec.bookingId : null;
    await query(
      `INSERT INTO message_logs (booking_id, channel, template, to_address, provider_id, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [bookingId, rec.channel, rec.kind, to, rec.providerId ?? null, rec.status, err]
    );
  } catch (e) {
    try {
      console.error(`[delivery] log failed: ${e instanceof Error ? e.message : String(e)}`);
    } catch {
      /* ignore */
    }
  }
}
