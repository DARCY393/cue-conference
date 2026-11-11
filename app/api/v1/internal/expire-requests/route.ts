import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { sendDueFeedbackRequests } from "@/lib/feedback";
import { completeFinishedBookings, expireOverdueRequests } from "@/lib/bookings";
import { sendDueReminders } from "@/lib/reminders";
import { sendDueParkingReminders, sendDueParkingStatusAlerts } from "@/lib/parking-recipients";
import { jsonError, jsonOk } from "@/lib/http";

function timingSafeStringsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Cron target: auto-declines "requested" bookings past their host response window. */
export async function POST(req: NextRequest) {
  const configured = (process.env.CRON_SECRET || "").trim();
  if (!configured) {
    return jsonError(503, "not_configured", "CRON_SECRET is not set");
  }
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || !timingSafeStringsEqual(provided, configured)) {
    return jsonError(401, "unauthorized", "Invalid or missing CRON_SECRET");
  }

  const result = await expireOverdueRequests();
  await completeFinishedBookings();
  const feedback = await sendDueFeedbackRequests();
  const reminders = await sendDueReminders();
  const parking = await sendDueParkingReminders();
  const parkingStatus = await sendDueParkingStatusAlerts();
  return jsonOk({
    feedbackRequestsSent: feedback.sentIds.length,
    expiredCount: result.expiredIds.length,
    expiredIds: result.expiredIds,
    expiredDraftIds: result.expiredDraftIds,
    remindersSent: reminders.remindedIds.length,
    parkingRemindersSent: parking.remindedIds.length,
    parkingStatusEmailsSent: parkingStatus.sentIds.length,
  });
}
