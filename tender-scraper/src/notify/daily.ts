// Daily job (systemd timer): deadline reminders (T-N) for everyone, plus a
// digest of new matches for digest-mode subscribers. Idempotent via sent_log.
//
// Reminders are alert-criteria based (server-side saved tenders don't exist yet).
// Run manually: `npm run notify:daily` (honours DRY_RUN setting).

import { loadConfig } from "./config";
import { initStore, allAlerts, allSavedWithSubscriber, lastDigestAt, type Alert, type Subscriber, type Channels } from "./store";
import { queryMeili, todayStartTs, type MeiliHit } from "./match";
import { formatReminder, formatDigest, type Item } from "./format";
import { deliver } from "./senders";

const asItem = (h: MeiliHit): Item => ({ title: h.title, url: h.url, deadline: h.deadline, region: h.region, publishing_entity: h.publishing_entity });

async function main() {
  await initStore();
  const cfg = await loadConfig();
  if (cfg.policy.globalPause) { console.log("global pause on — nothing sent."); return; }

  const rows = await allAlerts();
  const byMember = new Map<string, { sub: Subscriber; alerts: Alert[] }>();
  for (const r of rows) {
    const g = byMember.get(r.member_uuid) || { sub: r.subscriber, alerts: [] };
    g.alerts.push(r);
    byMember.set(r.member_uuid, g);
  }

  const today = todayStartTs();
  const isMonday = new Date().getUTCDay() === 1;
  let reminders = 0, digests = 0, savedReminders = 0;

  for (const { sub, alerts } of byMember.values()) {
    if (sub.paused_until && new Date(sub.paused_until).getTime() > Date.now()) continue;

    // ── deadline reminders (all subscribers), skipping snoozed alerts ──
    for (const alert of alerts) {
      if (alert.snoozed_until && new Date(alert.snoozed_until).getTime() > Date.now()) continue;
      for (const n of cfg.policy.reminderDays) {
        const hits = await queryMeili(cfg, alert.criteria, { deadlineDay: today + n * 86400, limit: 25 });
        for (const h of hits) {
          const sent = await deliver(cfg, sub, alert.channels, formatReminder(asItem(h), n, cfg.siteUrl), { kind: `reminder_${n}`, tenderId: h.id });
          if (sent.length) reminders++;
        }
      }
    }

    // ── digest (daily always; weekly only on Mondays) ──
    const freq = sub.digest_freq || (sub.digest_mode ? "daily" : "instant");
    if ((freq === "daily" || (freq === "weekly" && isMonday))) {
      const last = await lastDigestAt(sub.member_uuid);
      const sinceTs = last ? Math.floor(new Date(last).getTime() / 1000) : Math.floor(Date.now() / 1000) - 86400;
      const seen = new Set<string>();
      const items: Item[] = [];
      const channels: Channels = {};
      for (const alert of alerts) {
        if (alert.channels.email) channels.email = true;
        if (alert.channels.telegram) channels.telegram = true;
        const hits = await queryMeili(cfg, alert.criteria, { sinceTs, limit: 25 });
        for (const h of hits) { if (!seen.has(h.id)) { seen.add(h.id); items.push(asItem(h)); } }
      }
      if (items.length) {
        const dateKey = new Date().toISOString().slice(0, 10);
        const sent = await deliver(cfg, sub, channels, formatDigest(items.slice(0, 20), cfg.siteUrl), { kind: "digest", tenderId: `digest-${dateKey}` });
        if (sent.length) digests++;
      }
    }
  }

  // ── deadline reminders for individually bookmarked (saved) tenders ──
  for (const s of await allSavedWithSubscriber()) {
    const sub = s.subscriber;
    if (sub.paused_until && new Date(sub.paused_until).getTime() > Date.now()) continue;
    if (!s.deadline) continue;
    const dl = Math.floor(Date.parse(s.deadline) / 1000);
    const n = Math.round((dl - today) / 86400);
    if (!cfg.policy.reminderDays.includes(n)) continue;
    const item: Item = { title: s.title || s.tender_id, url: s.url || cfg.siteUrl, deadline: s.deadline };
    const sent = await deliver(cfg, sub, { email: true, telegram: true }, formatReminder(item, n, cfg.siteUrl), { kind: `savedreminder_${n}`, tenderId: s.tender_id });
    if (sent.length) savedReminders++;
  }

  console.log(`Done. reminders=${reminders}, digests=${digests}, saved-reminders=${savedReminders}${cfg.policy.dryRun ? " (DRY_RUN)" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
