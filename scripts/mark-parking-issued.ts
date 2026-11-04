import "dotenv/config";
import { markParkingIssued } from "../lib/parking-recipients";

// Usage: tsx scripts/mark-parking-issued.ts <bookingId> [--undo] [--by "name"] [--note "text"]
async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) throw new Error('Usage: mark-parking-issued.ts <bookingId> [--undo] [--by "name"] [--note "text"]');
  const val = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const res = await markParkingIssued(id, { issued: !args.includes("--undo"), by: val("--by") || "box script", note: val("--note") });
  if (!res.ok) throw new Error(res.message);
  console.log(res.meta.issuedAt ? `Marked issued at ${res.meta.issuedAt} by ${res.meta.issuedBy}` : "Cleared issued status");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
