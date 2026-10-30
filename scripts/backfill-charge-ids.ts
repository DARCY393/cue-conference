/**
 * One-off: fill bookings.stripe_charge_id for captured bookings from Stripe.
 * Read-only on Stripe (PaymentIntent GETs on the connected account); writes only our DB.
 * Usage: npx tsx scripts/backfill-charge-ids.ts [--dry-run]
 */
import "dotenv/config";
import { query } from "../lib/db";
import { getStripe, stripeRequestOptions } from "../lib/stripe";
import { latestChargeId } from "../lib/bookings";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe not configured");
  const { rows } = await query<{ id: string; pi: string }>(
    `SELECT id, stripe_payment_intent_id AS pi FROM bookings
      WHERE stripe_charge_id IS NULL AND stripe_payment_intent_id IS NOT NULL
        AND stripe_payment_intent_id NOT LIKE '%\\_mock\\_%'
        AND status IN ('accepted','in_progress','completed','cancelled')
      ORDER BY created_at`
  );
  let filled = 0;
  for (const r of rows) {
    try {
      const pi = await stripe.paymentIntents.retrieve(r.pi, {}, stripeRequestOptions());
      const ch = pi.status === "succeeded" ? latestChargeId(pi) : undefined;
      if (!ch) {
        console.log(`${r.id}: PI ${pi.status}, no captured charge — skipped`);
        continue;
      }
      if (!dry) {
        await query(`UPDATE bookings SET stripe_charge_id = $2 WHERE id = $1 AND stripe_charge_id IS NULL`, [r.id, ch]);
      }
      filled++;
      console.log(`${r.id}: ${ch}${dry ? " (dry run)" : ""}`);
    } catch (err) {
      console.error(`${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`${dry ? "Would fill" : "Filled"} ${filled} of ${rows.length} booking(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
