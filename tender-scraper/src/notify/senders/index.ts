// Delivery orchestrator — fan a message out to a subscriber's enabled channels,
// with idempotency (sent_log reserve → send → release-on-failure), global pause,
// quiet hours, per-member daily cap, and DRY_RUN. Adding SMS/WhatsApp later is
// just another branch here once their send()s are implemented.
import type { Config } from "../config";
import type { Channels, Subscriber } from "../store";
import { markSent, unmarkSent, sentCountToday } from "../store";
import { sendTelegram } from "./telegram";
import { sendEmail } from "./email";

export type Msg = { subject: string; html: string; text: string; telegramHtml: string };
export type SendMeta = { kind: string; tenderId: string };

function inQuietHours(cfg: Config): boolean {
  // EAT = UTC+3.
  const h = (new Date().getUTCHours() + 3) % 24;
  const { quietStart: s, quietEnd: e } = cfg.policy;
  if (s === e) return false;
  return s < e ? h >= s && h < e : h >= s || h < e;
}

export async function deliver(
  cfg: Config,
  sub: Subscriber,
  channels: Channels,
  msg: Msg,
  meta: SendMeta,
  opts: { ignoreQuietHours?: boolean } = {},
): Promise<string[]> {
  const sent: string[] = [];
  if (cfg.policy.globalPause) return sent;
  if (sub.paused_until && new Date(sub.paused_until).getTime() > Date.now()) return sent;
  // Instant sends respect quiet hours; batch/daily deliveries (the designated
  // delivery window) pass ignoreQuietHours so nothing is silently dropped.
  if (!opts.ignoreQuietHours && inQuietHours(cfg)) return sent;
  if ((await sentCountToday(sub.member_uuid)) >= cfg.policy.dailyCap) return sent;

  async function via(channel: string, ok: boolean, fn: () => Promise<void>) {
    if (!ok) return;
    if (!(await markSent(sub.member_uuid, meta.tenderId, meta.kind, channel))) return; // already sent
    try {
      if (!cfg.policy.dryRun) await fn();
      sent.push(channel);
    } catch (e) {
      await unmarkSent(sub.member_uuid, meta.tenderId, meta.kind, channel); // release → retried next run
      console.error(`[notify] ${channel} failed for ${sub.member_uuid}: ${(e as Error).message}`);
    }
  }

  await via("telegram", channels.telegram !== false && cfg.telegram.enabled && !!sub.telegram_chat_id, () =>
    sendTelegram(cfg, sub.telegram_chat_id as string, msg.telegramHtml),
  );
  await via("email", channels.email !== false && cfg.email.enabled && !!sub.email, () =>
    sendEmail(cfg, sub.email as string, msg.subject, msg.html, msg.text),
  );
  return sent;
}
