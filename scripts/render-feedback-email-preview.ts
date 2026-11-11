import { writeFileSync, mkdirSync } from "node:fs";
import { renderFeedbackRequestEmail } from "../lib/email-templates";

const dir = process.argv[2] || "/workspace/tmp";
mkdirSync(dir, { recursive: true });
const email = renderFeedbackRequestEmail({ roomName: "M1", startsAt: "2026-11-11T16:30:00Z", endsAt: "2026-11-11T20:30:00Z", url: "https://preview.example/bookings/preview/feedback?t=preview" });
writeFileSync(`${dir}/email-feedback-request.html`, email.html);
console.log(`Rendered feedback email to ${dir}/email-feedback-request.html`);
