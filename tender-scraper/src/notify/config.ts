// Runtime config = operator settings from the DB (edited on the admin page)
// merged over defaults. Bootstrap-only values (Ghost/Meili URLs, DB creds) come
// from env. Nothing operator-facing needs a redeploy to change.

import { getSettings } from "./store";

export type Config = {
  telegram: { token: string; username: string; webhookSecret: string; enabled: boolean };
  email: { host: string; port: number; user: string; pass: string; from: string; secure: boolean; enabled: boolean };
  ghostWebhookSecret: string;
  policy: {
    defaultDigest: boolean;
    digestHour: number; // 0-23, EAT
    reminderDays: number[];
    quietStart: number; quietEnd: number; // hours EAT, inclusive-exclusive
    dailyCap: number;
    globalPause: boolean;
    dryRun: boolean;
    includeClosed: boolean;
  };
  ghostUrl: string;
  ghostAdminUrl: string;
  meiliHost: string;
  meiliKey: string;
  meiliIndex: string;
  siteUrl: string;
};

const bool = (v: string | undefined, d: boolean) => (v == null || v === "" ? d : v === "1" || v === "true");
const num = (v: string | undefined, d: number) => (v == null || v === "" || isNaN(Number(v)) ? d : Number(v));

export async function loadConfig(): Promise<Config> {
  const s = await getSettings();
  const ghostUrl = (process.env.GHOST_URL || process.env.GHOST_ADMIN_API_URL || "https://tenders.qelal.et").replace(/\/+$/, "");
  return {
    telegram: {
      token: s.telegram_bot_token || "",
      username: s.telegram_bot_username || "",
      webhookSecret: s.telegram_webhook_secret || "",
      enabled: bool(s.channel_telegram_enabled, true) && !!s.telegram_bot_token,
    },
    email: {
      host: s.smtp_host || process.env.NOTIFY_SMTP_HOST || "",
      port: num(s.smtp_port, 465),
      user: s.smtp_user || "",
      pass: s.smtp_pass || "",
      from: s.smtp_from || "Qellal <info@bespo.et>",
      secure: bool(s.smtp_secure, true),
      enabled: bool(s.channel_email_enabled, true) && !!(s.smtp_host || process.env.NOTIFY_SMTP_HOST),
    },
    ghostWebhookSecret: s.ghost_webhook_secret || "",
    policy: {
      defaultDigest: bool(s.default_digest_mode, false),
      digestHour: num(s.digest_hour, 6),
      reminderDays: (s.reminder_days || "7,3,1").split(",").map((x) => Number(x.trim())).filter((n) => n > 0),
      quietStart: num(s.quiet_start, 22),
      quietEnd: num(s.quiet_end, 7),
      dailyCap: num(s.daily_cap, 30),
      globalPause: bool(s.global_pause, false),
      dryRun: bool(s.dry_run, false),
      includeClosed: bool(s.include_closed, false),
    },
    ghostUrl,
    ghostAdminUrl: ghostUrl,
    meiliHost: (s.meili_host || process.env.MEILI_HOST || "").replace(/\/+$/, ""),
    meiliKey: s.meili_search_key || process.env.MEILI_SEARCH_KEY || process.env.MEILI_MASTER_KEY || "",
    meiliIndex: process.env.MEILI_INDEX || "ghost_tenders",
    siteUrl: ghostUrl,
  };
}

// Keys the admin page manages (with which are secret → masked in the UI).
export const SETTING_KEYS: { key: string; secret?: boolean; label: string }[] = [
  { key: "telegram_bot_token", secret: true, label: "Telegram bot token" },
  { key: "telegram_bot_username", label: "Telegram bot username (without @)" },
  { key: "telegram_webhook_secret", secret: true, label: "Telegram webhook secret" },
  { key: "ghost_webhook_secret", secret: true, label: "Ghost webhook secret" },
  { key: "channel_telegram_enabled", label: "Telegram channel enabled (1/0)" },
  { key: "channel_email_enabled", label: "Email channel enabled (1/0)" },
  { key: "smtp_host", label: "SMTP host" },
  { key: "smtp_port", label: "SMTP port" },
  { key: "smtp_user", label: "SMTP user" },
  { key: "smtp_pass", secret: true, label: "SMTP password" },
  { key: "smtp_from", label: "Email From" },
  { key: "smtp_secure", label: "SMTP TLS (1/0)" },
  { key: "default_digest_mode", label: "Default new subscribers to digest (1/0)" },
  { key: "digest_hour", label: "Daily digest hour (0-23, EAT)" },
  { key: "reminder_days", label: "Deadline reminder days (e.g. 7,3,1)" },
  { key: "quiet_start", label: "Quiet hours start (0-23)" },
  { key: "quiet_end", label: "Quiet hours end (0-23)" },
  { key: "daily_cap", label: "Max sends per member per day" },
  { key: "include_closed", label: "Alert on closed tenders too (1/0)" },
  { key: "global_pause", label: "GLOBAL PAUSE — stop all sends (1/0)" },
  { key: "dry_run", label: "DRY RUN — log instead of send (1/0)" },
  { key: "meili_host", label: "Meilisearch host (for matching)" },
  { key: "meili_search_key", secret: true, label: "Meilisearch search key" },
];
