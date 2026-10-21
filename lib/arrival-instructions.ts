export interface ArrivalInstructionsInput {
  roomName: string;
  /** Reserved parking passes under the building (0 = none pre-booked). */
  parkingPasses?: number;
}

/**
 * Single source of truth for arrival/access instructions, shared by both the
 * HTML and plain-text email renderers in lib/email-templates.ts. Email-only —
 * the Wi-Fi password must never appear on the public web page.
 */
/**
 * The guest Wi-Fi password comes from CUE_WIFI_PASSWORD (server env only) so it never sits in
 * the public repo. Without it, guests are told to ask staff.
 */
function wifiLine(): string {
  const pw = (process.env.CUE_WIFI_PASSWORD || "").trim();
  return pw
    ? `Wi-Fi: network "cue", password "${pw}"`
    : `Wi-Fi: network "cue" (ask D'Arcy or the front desk for the password)`;
}

export function arrivalInstructionLines(input: ArrivalInstructionsInput): string[] {
  const { roomName, parkingPasses = 0 } = input;
  const parkingLine =
    parkingPasses > 0
      ? `Your reserved parking under the building is included: ${parkingPasses} pass${
          parkingPasses === 1 ? "" : "es"
        } per day.`
      : "Parking is not available under the building unless you pre-booked it. There's public parking across the street at 720 N. Ervay St, Dallas, TX 75201.";

  return [
    "Thank you for booking a conference room at Cue.",
    "Address: 750 N St Paul St #200, Dallas, TX 75201",
    parkingLine,
    "When you arrive, go to the 2nd floor. If security asks, let them know you're going to Cue for a meeting.",
    `When you get off the elevator, follow the signs to the conference rooms and go to ${roomName}.`,
    "Each room has a screen you can connect to by HDMI or wirelessly.",
    wifiLine(),
    "Coffee and water are in the kitchenette in the conference room, and glasses are in the cupboard.",
    "Feel free to order food and have it delivered. Mendocino Farms down the street is a good option.",
    "Feel free to use the sitting areas or the patio outside the conference rooms for breaks.",
    "Bathrooms are around the other side, down the hall to the left.",
    "Please throw away all garbage and tidy up before you leave.",
    "Questions? Reach D'Arcy Young at 214-883-4174 or visit suite 212.",
  ];
}
