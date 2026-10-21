import { NextRequest } from "next/server";
import { getEmailSender } from "@/lib/email";
import { jsonError, jsonOk } from "@/lib/http";
import { isValidEmail } from "@/lib/validate";
import { getClientIp, isRateLimited } from "@/lib/contact-rate-limit";


function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return jsonError(429, "rate_limited", "Too many requests — try again later.");
  }

  let body: {
    name?: string;
    email?: string;
    message?: string;
    website?: string;
    roomName?: string;
    roomSlug?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }

  // Honeypot: real guests never see/fill this field. Pretend success, skip the send.
  if (body.website) {
    return jsonOk({ ok: true });
  }

  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const message = (body.message || "").trim();
  const roomName = (body.roomName || "").trim() || undefined;
  const roomSlug = (body.roomSlug || "").trim() || undefined;

  if (!name || !email || !message) {
    return jsonError(400, "bad_request", "name, email, and message are required");
  }
  if (name.length > 100) {
    return jsonError(400, "bad_request", "name must be 100 characters or fewer");
  }
  if (message.length > 5000) {
    return jsonError(400, "bad_request", "message must be 5000 characters or fewer");
  }
  if (!isValidEmail(email)) {
    return jsonError(400, "bad_request", "Enter a valid email address");
  }

  const to = process.env.CONTACT_EMAIL || "darcy@thecue.work";
  const roomLine = roomName ? ` about ${roomName}` : "";
  const subject = `New message from thecue.work${roomLine}`;
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    roomName ? `Room: ${roomName}${roomSlug ? ` (${roomSlug})` : ""}` : null,
    "",
    message,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const html = `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
${roomName ? `<p><strong>Room:</strong> ${escapeHtml(roomName)}${roomSlug ? ` (${escapeHtml(roomSlug)})` : ""}</p>` : ""}
<p style="white-space:pre-wrap;">${escapeHtml(message)}</p>`;

  await getEmailSender().send({
    to,
    template: "contact_form",
    subject,
    text,
    html,
    replyTo: email,
  });

  return jsonOk({ ok: true });
}
