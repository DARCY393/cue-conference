import "dotenv/config";
import { expireOverdueRequests } from "../lib/bookings";

async function main() {
  const result = await expireOverdueRequests();
  if (result.expiredIds.length === 0) {
    console.log("No overdue booking requests to expire.");
    return;
  }
  console.log(
    `Expired ${result.expiredIds.length} overdue booking request(s): ${result.expiredIds.join(", ")}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
