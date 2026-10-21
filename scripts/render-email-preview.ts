import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { renderBookingConfirmationEmail } from "../lib/email-templates";

const OUTPUT_PATH = "/workspace/tmp/email-confirmation.html";

function main() {
  const { html } = renderBookingConfirmationEmail({
    roomName: "M2",
    startsAt: "2027-01-04T15:00:00.000Z",
    endsAt: "2027-01-04T17:00:00.000Z",
    totalCents: 29000,
    parkingPasses: 2,
    parkingCents: 4000,
    bookingId: "11111111-1111-4111-8111-111111111111",
  });
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, html, "utf8");
  console.log(`Wrote sample confirmation email HTML to ${OUTPUT_PATH}`);
}

main();
