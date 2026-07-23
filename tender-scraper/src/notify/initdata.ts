// Validate a Telegram Mini App `initData` string server-side.
//
// This is the ONLY thing that authenticates a Mini App request — the client is
// untrusted, so `initDataUnsafe` must never be believed. The signed `initData`
// query string is verified against the bot token per Telegram's spec:
//
//   secret_key       = HMAC_SHA256(key="WebAppData", msg=bot_token)
//   data_check_string = every "key=value" pair EXCEPT `hash`, sorted by key,
//                       joined with "\n"
//   valid iff hex(HMAC_SHA256(key=secret_key, msg=data_check_string)) === hash
//
// Plus a freshness window on `auth_date` so a leaked initData can't be replayed
// forever. Comparison is timing-safe.
//
// Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

import crypto from "node:crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
};

export type InitDataResult = { userId: string; user: TelegramUser };

// Max age of a signed initData we'll accept (seconds). 24h is Telegram's own
// suggested ceiling — long enough that a Mini App left open still works.
const MAX_AGE_SECONDS = 24 * 60 * 60;

export function validateInitData(botToken: string, initData: string, maxAgeSeconds = MAX_AGE_SECONDS): InitDataResult | null {
  if (!botToken || !initData) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash) return null;

  // data_check_string: all pairs except `hash`, sorted by key, "key=value\n".
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // Timing-safe compare (equal-length hex strings).
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Freshness: reject stale (replayed) initData.
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Number.isNaN(authDate)) return null;
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec < -300 || ageSec > maxAgeSeconds) return null; // small negative slack for clock skew

  // The signed `user` field is the trusted identity.
  let user: TelegramUser;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number") return null;

  return { userId: String(user.id), user };
}
