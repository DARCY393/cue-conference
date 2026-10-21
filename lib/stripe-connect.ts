/**
 * Stripe Connect: Honeycomb's Stripe account is the PLATFORM, the SPP/Cue Stripe account is the
 * CONNECTED account. When enabled, every PaymentIntent is a DIRECT charge on the connected account
 * (Stripe-Account header) with application_fee_amount = round(APPLICATION_FEE_BPS of the charge).
 *
 * OFF unless both STRIPE_PLATFORM_SECRET_KEY and STRIPE_CONNECTED_ACCOUNT_ID are set, so the
 * single-account behavior (STRIPE_SECRET_KEY) is unchanged by default. Live keys are refused
 * unless ALLOW_STRIPE_LIVE=true (only after D'Arcy approves going live).
 */

export const DEFAULT_APPLICATION_FEE_BPS = 1000; // 10%

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function isPlaceholder(v: string): boolean {
  return !v || v.includes("...") || v.endsWith("_here");
}

export function isLiveKey(key: string): boolean {
  return /^(sk|rk|pk)_live_/.test(key);
}

export type ConnectConfig = {
  platformSecretKey: string;
  connectedAccountId: string;
  feeBps: number;
  feeOnRoomOnly: boolean;
};

/** Parse APPLICATION_FEE_BPS (0-10000, integer); falls back to 1000 (10%) when unset or invalid. */
export function applicationFeeBps(): number {
  const raw = env("APPLICATION_FEE_BPS");
  if (!raw) return DEFAULT_APPLICATION_FEE_BPS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10000) {
    console.error(`[stripe-connect] APPLICATION_FEE_BPS=${raw} is invalid (0-10000); using ${DEFAULT_APPLICATION_FEE_BPS}.`);
    return DEFAULT_APPLICATION_FEE_BPS;
  }
  return n;
}

/** Returns the Connect config, or null when Connect is off. Throws on live keys without approval. */
export function getConnectConfig(): ConnectConfig | null {
  const platformSecretKey = env("STRIPE_PLATFORM_SECRET_KEY");
  const connectedAccountId = env("STRIPE_CONNECTED_ACCOUNT_ID");
  if (isPlaceholder(platformSecretKey) || isPlaceholder(connectedAccountId)) return null;
  if (!/^acct_[A-Za-z0-9]+$/.test(connectedAccountId)) {
    throw new Error("STRIPE_CONNECTED_ACCOUNT_ID must look like acct_…");
  }
  if (isLiveKey(platformSecretKey) && process.env.ALLOW_STRIPE_LIVE !== "true") {
    throw new Error(
      "Live Stripe platform key detected but ALLOW_STRIPE_LIVE is not 'true'. Refusing to use it (test mode only)."
    );
  }
  if (!isLiveKey(platformSecretKey) && !/^(sk|rk)_test_/.test(platformSecretKey)) {
    throw new Error("STRIPE_PLATFORM_SECRET_KEY must be a sk_test_/rk_test_ key.");
  }
  return {
    platformSecretKey,
    connectedAccountId,
    feeBps: applicationFeeBps(),
    feeOnRoomOnly: env("APPLICATION_FEE_ROOM_ONLY") === "true",
  };
}

export function isConnectEnabled(): boolean {
  return getConnectConfig() !== null;
}

/** round(amount × bps / 10000), never negative, never above the amount. */
export function computeApplicationFeeCents(amountCents: number, bps: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0 || bps <= 0) return 0;
  return Math.min(amountCents, Math.round((amountCents * bps) / 10000));
}

/**
 * Fee for a charge. By default the fee base is the full charged amount (room + parking + add-ons).
 * With APPLICATION_FEE_ROOM_ONLY=true and a roomCents value, only the room portion is used.
 */
export function applicationFeeFor(
  cfg: ConnectConfig,
  amountCents: number,
  roomCents?: number
): number {
  const base = cfg.feeOnRoomOnly && typeof roomCents === "number" ? Math.min(roomCents, amountCents) : amountCents;
  return computeApplicationFeeCents(base, cfg.feeBps);
}
