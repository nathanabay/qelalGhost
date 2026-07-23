// Notifier HTTP service. Fronted by Caddy at tenders.qelal.et/alerts/* (which
// strips the /alerts prefix), so routes below are matched WITHOUT it.
//
//   Member API (ghost-members-ssr cookie): /api/subscriptions, /api/prefs, /api/telegram/link
//   Webhooks (secret in path):             /telegram/webhook/<secret>, /ghost/webhook/<secret>
//   Staff admin (ghost-admin cookie):      /admin/ + /admin/api/*   (/admin/sidebar.js is public)

import http from "node:http";
import crypto from "node:crypto";
import { loadConfig, SETTING_KEYS } from "./config";
import * as store from "./store";
import { memberFromCookie, staffFromCookie } from "./auth";
import { factsFromPost, matches, getById } from "./match";
import { formatNew } from "./format";
import { deliver } from "./senders";
import { sendTelegram, telegramGetMe, telegramSetWebhook, setBotCommands } from "./senders/telegram";
import { sendEmail, verifyEmail } from "./senders/email";
import { renderAdminPage, ADMIN_SIDEBAR_JS } from "./admin-page";
import { handleUpdate, BOT_COMMANDS } from "./bot";

const PORT = Number(process.env.NOTIFY_PORT || 3839);

// A stray rejection (e.g. sendTelegram to a user who blocked the bot) must never
// take the whole service down — log and carry on.
process.on("unhandledRejection", (e) => console.error("[notify] unhandledRejection:", (e as Error)?.message || e));
process.on("uncaughtException", (e) => console.error("[notify] uncaughtException:", e?.message || e));

function send(res: http.ServerResponse, code: number, body: unknown, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

function buildIcs(title: string, deadline: string, url: string): string {
  const d = deadline.replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Qellal//Tender//EN", "BEGIN:VEVENT",
    `UID:${d}-${Math.random().toString(36).slice(2)}@qelal.et`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${esc("Tender deadline — " + title.slice(0, 120))}`,
    `DESCRIPTION:${esc(url)}`, `URL:${url}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const cfg = await loadConfig();

    // ── public: sidebar injector (adds the "Alerts" nav link in Ghost admin) ──
    if (path === "/admin/sidebar.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(ADMIN_SIDEBAR_JS);
    }

    // ── public: .ics for a tender's deadline (the bot's "Add to calendar") ──
    if (path.startsWith("/ics/")) {
      const h = await getById(cfg, decodeURIComponent(path.slice(5)));
      if (!h || !h.deadline) return send(res, 404, "no calendar for this tender", "text/plain");
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="tender.ics"', "Cache-Control": "no-store" });
      return res.end(buildIcs(h.title, h.deadline, h.url));
    }

    // ── Telegram webhook ── (header-secret auth on the fixed path; the legacy
    // secret-in-path route is kept so re-registration isn't a hard cutover)
    const legacyTg = cfg.telegram.webhookSecret && path === `/telegram/webhook/${cfg.telegram.webhookSecret}`;
    if (req.method === "POST" && (path === "/telegram/webhook" || legacyTg)) {
      if (path === "/telegram/webhook" && (!cfg.telegram.webhookSecret || req.headers["x-telegram-bot-api-secret-token"] !== cfg.telegram.webhookSecret)) {
        return send(res, 401, { error: "unauthorized" });
      }
      const upd = await readJson(req);
      handleUpdate(cfg, upd).catch((e) => console.error("[notify] telegram:", e));
      return send(res, 200, { ok: true }); // ack fast
    }
    // ── Ghost post.published webhook ──
    if (req.method === "POST" && path === `/ghost/webhook/${cfg.ghostWebhookSecret}` && cfg.ghostWebhookSecret) {
      const body = await readJson(req);
      handleGhostPublished(cfg, body).catch((e) => console.error("[notify] ghost webhook:", e));
      return send(res, 200, { ok: true }); // ack fast; fan-out async
    }

    // ── member API ──
    if (path.startsWith("/api/")) return memberApi(req, res, cfg, path, url);

    // ── staff admin ──
    if (path === "/admin" || path === "/admin/") {
      const staff = await staffFromCookie(req, cfg.ghostAdminUrl);
      if (!staff) { res.writeHead(302, { Location: "/ghost/" }); return res.end(); }
      return send(res, 200, renderAdminPage(), "text/html; charset=utf-8");
    }
    if (path.startsWith("/admin/api/")) return adminApi(req, res, cfg, path);

    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String((e as Error).message || e) });
  }
});
server.listen(PORT, "0.0.0.0", () => console.log(`tender-notify on 0.0.0.0:${PORT}`));

// ── member API ───────────────────────────────────────────────────────────────
async function memberApi(req: http.IncomingMessage, res: http.ServerResponse, cfg: Awaited<ReturnType<typeof loadConfig>>, path: string, url: URL) {
  const member = await memberFromCookie(req, cfg.ghostUrl);
  if (!member) return send(res, 401, { error: "Sign in to manage alerts" });
  await store.upsertSubscriber(member.uuid, member.email);

  if (path === "/api/subscriptions" && req.method === "GET") {
    const [alerts, sub] = await Promise.all([store.listAlerts(member.uuid), store.getSubscriber(member.uuid)]);
    return send(res, 200, {
      alerts,
      telegram_linked: !!sub?.telegram_chat_id,
      digest_mode: !!sub?.digest_mode,
      paused_until: sub?.paused_until || null,
      email: member.email,
    });
  }
  if (path === "/api/subscriptions" && req.method === "POST") {
    const b = await readJson(req);
    const criteria = (b.criteria as store.Criteria) || {};
    const channels = (b.channels as store.Channels) || { email: true, telegram: true };
    const label = String(b.label || "All tenders").slice(0, 255);
    const id = await store.createAlert(member.uuid, label, criteria, channels);
    return send(res, 200, { ok: true, id });
  }
  if (path === "/api/subscriptions" && req.method === "DELETE") {
    const id = Number(url.searchParams.get("id"));
    if (id) await store.deleteAlert(member.uuid, id);
    return send(res, 200, { ok: true });
  }
  if (path === "/api/prefs" && req.method === "POST") {
    const b = await readJson(req);
    const patch: { digest_mode?: boolean; paused_until?: Date | null } = {};
    if (typeof b.digest_mode === "boolean") patch.digest_mode = b.digest_mode;
    if (b.pause_days !== undefined) patch.paused_until = Number(b.pause_days) > 0 ? new Date(Date.now() + Number(b.pause_days) * 86400000) : null;
    await store.setPrefs(member.uuid, patch);
    return send(res, 200, { ok: true });
  }
  if (path === "/api/telegram/link" && req.method === "POST") {
    if (!cfg.telegram.username) return send(res, 400, { error: "Telegram not configured" });
    const token = crypto.randomUUID().replace(/-/g, "");
    await store.setLinkToken(member.uuid, token);
    return send(res, 200, { url: `https://t.me/${cfg.telegram.username}?start=${token}`, token });
  }
  send(res, 404, { error: "not found" });
}

// ── Ghost post.published → instant alerts ─────────────────────────────────────
async function handleGhostPublished(cfg: Awaited<ReturnType<typeof loadConfig>>, body: Record<string, unknown>) {
  const post = ((body.post as { current?: unknown })?.current) as Record<string, unknown> | undefined;
  if (!post) return;
  const facts = factsFromPost(post);
  if (!facts) return;
  const item = { title: facts.title, url: facts.url, deadline: facts.deadline, region: facts.region, publishing_entity: facts.publishing_entity };
  const msg = formatNew(item, cfg.siteUrl);
  const rows = await store.allAlerts();
  for (const a of rows) {
    if (a.subscriber.digest_mode) continue; // digest members get it in the daily digest
    if (a.subscriber.paused_until && new Date(a.subscriber.paused_until).getTime() > Date.now()) continue;
    if (a.snoozed_until && new Date(a.snoozed_until).getTime() > Date.now()) continue;
    if (!matches(facts, a.criteria, cfg.policy.includeClosed)) continue;
    await deliver(cfg, a.subscriber, a.channels, msg, { kind: "new", tenderId: facts.id });
  }
}

// ── staff admin API ───────────────────────────────────────────────────────────
async function adminApi(req: http.IncomingMessage, res: http.ServerResponse, cfg: Awaited<ReturnType<typeof loadConfig>>, path: string) {
  const staff = await staffFromCookie(req, cfg.ghostAdminUrl);
  if (!staff) return send(res, 401, { error: "Sign in to Ghost admin" });

  if (path === "/admin/api/settings" && req.method === "GET") {
    const raw = await store.getSettings();
    const out: Record<string, string> = {};
    for (const k of SETTING_KEYS) out[k.key] = k.secret ? (raw[k.key] ? "••••" + raw[k.key].slice(-4) : "") : (raw[k.key] || "");
    return send(res, 200, { settings: out, keys: SETTING_KEYS, webhookUrls: {
      ghost: `${cfg.siteUrl}/ghost/alerts/ghost/webhook/${(await store.getSettings()).ghost_webhook_secret || "<set-secret>"}`,
      telegram: `${cfg.siteUrl}/ghost/alerts/telegram/webhook`,
    } });
  }
  if (path === "/admin/api/settings" && req.method === "POST") {
    const b = await readJson(req);
    const patch = (b.settings as Record<string, string>) || {};
    for (const [k, v] of Object.entries(patch)) {
      if (!SETTING_KEYS.some((s) => s.key === k)) continue;
      if (v === "" || /^••••/.test(v)) continue; // blank / masked-unchanged → skip
      await store.setSetting(k, v);
    }
    return send(res, 200, { ok: true });
  }
  if (path === "/admin/api/telegram/register" && req.method === "POST") {
    const me = await telegramGetMe(cfg.telegram.token);
    if (!me.ok) return send(res, 200, { ok: false, error: me.error });
    if (me.username && !cfg.telegram.username) await store.setSetting("telegram_bot_username", me.username);
    const hook = await telegramSetWebhook(cfg.telegram.token, `${cfg.siteUrl}/ghost/alerts/telegram/webhook`, cfg.telegram.webhookSecret);
    await setBotCommands(cfg, BOT_COMMANDS); // publish the "/" command menu
    return send(res, 200, { ok: hook.ok, username: me.username, error: hook.error });
  }
  if (path === "/admin/api/test-telegram" && req.method === "POST") {
    const b = await readJson(req);
    try { await sendTelegram(cfg, String(b.chat_id), "✅ Qellal test alert — Telegram is working."); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 200, { ok: false, error: (e as Error).message }); }
  }
  if (path === "/admin/api/test-email" && req.method === "POST") {
    const b = await readJson(req);
    const v = await verifyEmail(cfg);
    if (!v.ok) return send(res, 200, { ok: false, error: v.error });
    try { await sendEmail(cfg, String(b.to), "Qellal test alert", "<p>✅ Email alerts are working.</p>", "Email alerts are working."); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 200, { ok: false, error: (e as Error).message }); }
  }
  if (path === "/admin/api/insights" && req.method === "GET") {
    return send(res, 200, await store.insights());
  }
  if (path === "/admin/api/feedback" && req.method === "GET") {
    return send(res, 200, { feedback: await store.listFeedback() });
  }
  if (path === "/admin/api/broadcast" && req.method === "POST") {
    const b = await readJson(req);
    const text = String(b.text || "").trim().slice(0, 3000);
    if (!text) return send(res, 200, { ok: false, error: "empty message" });
    const chats = await store.allChatIds();
    let ok = 0;
    for (const c of chats) { try { await sendTelegram(cfg, c, text); ok++; } catch { /* skip */ } }
    return send(res, 200, { ok: true, sent: ok, total: chats.length });
  }
  send(res, 404, { error: "not found" });
}

// bootstrap the store on startup
store.initStore().catch((e) => { console.error("store init failed:", e); process.exit(1); });
