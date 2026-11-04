import "dotenv/config";
import { completeFinishedBookings, expireOverdueRequests } from "../lib/bookings";
import { sendDueReminders } from "../lib/reminders";
import { sendHostDecisionReminders } from "../lib/host-reminders";
import { sendDueParkingReminders, sendDueParkingStatusAlerts } from "../lib/parking-recipients";

async function main() {
  const result = await expireOverdueRequests();
  if (result.expiredIds.length === 0) {
    console.log("No overdue booking requests to expire.");
  } else {
    console.log(
      `Expired ${result.expiredIds.length} overdue booking request(s): ${result.expiredIds.join(", ")}`
    );
  }

  if (result.expiredDraftIds.length > 0) {
    console.log(
      `Discarded ${result.expiredDraftIds.length} abandoned checkout draft(s): ${result.expiredDraftIds.join(", ")}`
    );
  }

  const done = await completeFinishedBookings();
  if (done.completedIds.length === 0) {
    console.log("No finished bookings to mark completed.");
  } else {
    console.log(`Marked ${done.completedIds.length} finished booking(s) completed: ${done.completedIds.join(", ")}`);
  }

  const hostReminders = await sendHostDecisionReminders();
  if (hostReminders.reminded.length === 0) {
    console.log("No host decision reminders due.");
  } else {
    console.log(
      `Sent ${hostReminders.reminded.length} host decision reminder(s): ${hostReminders.reminded.map((r) => `${r.id} (${r.slot})`).join(", ")}`
    );
  }

  const reminders = await sendDueReminders();
  if (reminders.remindedIds.length === 0) {
    console.log("No reminder emails due.");
  } else {
    console.log(
      `Sent ${reminders.remindedIds.length} reminder email(s): ${reminders.remindedIds.join(", ")}`
    );
  }

  const parking = await sendDueParkingReminders();
  if (parking.remindedIds.length === 0) {
    console.log("No parking-list reminders due.");
  } else {
    console.log(`Sent ${parking.remindedIds.length} parking-list reminder(s): ${parking.remindedIds.join(", ")}`);
  }

  const status = await sendDueParkingStatusAlerts();
  if (status.sentIds.length === 0) {
    console.log("No parking-status host emails due.");
  } else {
    console.log(`Sent ${status.sentIds.length} parking-status host email(s): ${status.sentIds.join(", ")}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
