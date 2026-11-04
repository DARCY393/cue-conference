import { mkdirSync, writeFileSync } from "fs";
import { renderHostParkingRecipientsEmail, renderParkingRecipientsRequestEmail } from "../lib/email-templates";

const OUT = "/workspace/tmp";
const sample = {
  roomName: "M2",
  startsAt: "2026-11-19T15:00:00.000Z",
  endsAt: "2026-11-19T23:00:00.000Z",
  parkingPasses: 4,
};
mkdirSync(OUT, { recursive: true });
const guest = renderParkingRecipientsRequestEmail({ ...sample, url: "https://book.thecue.work/bookings/example/parking?t=example" });
writeFileSync(`${OUT}/email-parking-request.html`, guest.html);
const host = renderHostParkingRecipientsEmail({
  ...sample,
  guestName: "Sample Guest",
  guestEmail: "guest@example.com",
  bookingId: "11111111-1111-4111-8111-111111111111",
  recipients: [{ phone: "+12145550123" }, { email: "bob@example.com" }],
});
writeFileSync(`${OUT}/email-parking-host-alert.html`, host.html);
console.log(`Subject: ${guest.subject}\nWrote ${OUT}/email-parking-request.html and ${OUT}/email-parking-host-alert.html`);
