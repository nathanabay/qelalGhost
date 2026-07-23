// Conversational Telegram bot: commands, inline menus, live tender search,
// browse (latest / closing soon / today), and in-chat alert management. Handles
// both `message` and `callback_query` updates. Plain (non-command) text is
// treated as a search query.

import type { Config } from "./config";
import * as store from "./store";
import { queryMeili, todayStartTs, type MeiliHit } from "./match";
import { sendTelegram, answerCallback, type InlineKeyboard } from "./senders/telegram";

const PAGE = 5;
const esc = (s: string) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cbq = (s: string) => s.replace(/[^\x20-\x7E]/g, "").slice(0, 40); // callback-data-safe, short

export const BOT_COMMANDS = [
  { command: "menu", description: "Main menu" },
  { command: "search", description: "Search tenders by keyword" },
  { command: "latest", description: "Newest tenders" },
  { command: "closing", description: "Closing this week" },
  { command: "today", description: "Closing today" },
  { command: "alerts", description: "My saved alerts" },
  { command: "digest", description: "Toggle daily digest" },
  { command: "pause", description: "Pause alerts for 7 days" },
  { command: "resume", description: "Resume alerts" },
  { command: "status", description: "My subscription status" },
  { command: "help", description: "How this bot works" },
  { command: "stop", description: "Unlink this chat" },
];

function menuKeyboard(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "🔍 Search", callback_data: "search" }, { text: "📅 Closing soon", callback_data: "closing" }],
    [{ text: "🆕 Latest", callback_data: "latest" }, { text: "🔔 My alerts", callback_data: "alerts" }],
    [{ text: "⚙️ Settings", callback_data: "settings" }, { text: "ℹ️ Help", callback_data: "help" }],
  ] };
}
function settingsKeyboard(sub: store.Subscriber | null): InlineKeyboard {
  const paused = sub?.paused_until && new Date(sub.paused_until).getTime() > Date.now();
  return { inline_keyboard: [
    [{ text: sub?.digest_mode ? "📬 Digest: ON" : "📬 Digest: OFF", callback_data: "digest" }],
    [paused ? { text: "▶️ Resume alerts", callback_data: "resume" } : { text: "⏸ Pause 7 days", callback_data: "pause" }],
    [{ text: "🔕 Unlink this chat", callback_data: "unlink" }],
    [{ text: "⬅️ Menu", callback_data: "menu" }],
  ] };
}

function metaOf(h: MeiliHit): string {
  const p: string[] = [];
  if (h.deadline) { const d = Math.round((Date.parse(h.deadline) / 1000 - todayStartTs()) / 86400); p.push(d < 0 ? `closed ${h.deadline}` : d === 0 ? "closes today" : `${d}d left`); }
  if (h.publishing_entity) p.push(h.publishing_entity);
  if (h.region) p.push(h.region);
  return p.join(" · ");
}
function renderList(title: string, hits: MeiliHit[], q?: string, offset = 0): { text: string; keyboard: InlineKeyboard } {
  if (!hits.length) return { text: `${title}\n\nNo tenders found.`, keyboard: menuKeyboard() };
  const lines = hits.map((h, i) => `${offset + i + 1}. <a href="${esc(h.url)}">${esc(h.title.slice(0, 90))}</a>\n   <i>${esc(metaOf(h))}</i>`);
  const rows: { text: string; callback_data?: string; url?: string }[][] = [];
  if (q) rows.push([{ text: `🔔 Alert me for "${q.slice(0, 20)}"`, callback_data: `alert:${cbq(q)}` }]);
  const nav: { text: string; callback_data: string }[] = [];
  if (offset > 0) nav.push({ text: "‹ Prev", callback_data: `more:${cbq(q || "")}:${Math.max(0, offset - PAGE)}` });
  if (hits.length === PAGE && q != null) nav.push({ text: "More ›", callback_data: `more:${cbq(q)}:${offset + PAGE}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return { text: `${title}\n\n${lines.join("\n\n")}`, keyboard: { inline_keyboard: rows } };
}

async function search(cfg: Config, chat: string, q: string, offset = 0) {
  const hits = await queryMeili(cfg, { q }, { limit: PAGE, offset });
  const r = renderList(`🔍 Results for "<b>${esc(q)}</b>"`, hits, q, offset);
  await sendTelegram(cfg, chat, r.text, r.keyboard);
}
async function browse(cfg: Config, chat: string, mode: "latest" | "closing" | "today") {
  let hits: MeiliHit[] = [], title = "";
  if (mode === "latest") { hits = await queryMeili(cfg, {}, { sort: ["published_ts:desc"], limit: PAGE }); title = "🆕 <b>Latest tenders</b>"; }
  else if (mode === "closing") { hits = await queryMeili(cfg, { deadline: "7" }, { sort: ["open_rank:asc", "deadline_ts:asc"], limit: PAGE }); title = "📅 <b>Closing this week</b>"; }
  else { hits = await queryMeili(cfg, {}, { deadlineDay: todayStartTs(), sort: ["deadline_ts:asc"], limit: PAGE }); title = "⏰ <b>Closing today</b>"; }
  const r = renderList(title, hits);
  await sendTelegram(cfg, chat, r.text, r.keyboard);
}

const WELCOME = (linked: boolean) =>
  `👋 <b>Qellal tender alerts</b>\n\nSearch every Ethiopian tender, browse what's closing soon, and get pinged when new tenders match your interests.\n\n• Just <b>type a keyword</b> to search (e.g. <i>electrical</i>)\n• /closing — closing this week · /latest — newest\n• /alerts — your saved alerts\n\n${linked ? "✅ This chat is linked to your account." : "🔗 Link your account from the <b>My alerts</b> page on the site to save alerts."}`;

const HELP =
  `ℹ️ <b>How this bot works</b>\n\n<b>Search</b> — type any keyword, or /search &lt;word&gt;\n<b>Browse</b> — /latest, /closing, /today\n<b>Alerts</b> — /alerts to see them; tap “🔔 Alert me” on any search to save one. New matching tenders + deadline reminders (7/3/1 days) arrive here.\n<b>Settings</b> — /digest (daily summary vs instant), /pause, /resume, /stop\n\nManage everything on the website: tenders.qelal.et/my-alerts`;

async function statusText(cfg: Config, sub: store.Subscriber | null): Promise<string> {
  if (!sub) return "This chat isn't linked yet. Open <b>My alerts</b> on the site and tap “Link Telegram”.";
  const alerts = await store.listAlerts(sub.member_uuid);
  const paused = sub.paused_until && new Date(sub.paused_until).getTime() > Date.now();
  return `📊 <b>Your status</b>\n\n• Alerts: <b>${alerts.length}</b>\n• Delivery: <b>${sub.digest_mode ? "daily digest" : "instant"}</b>\n• ${paused ? `Paused until ${new Date(sub.paused_until as string).toLocaleDateString()}` : "Active"}\n• Email: ${esc(sub.email || "—")}`;
}

// ── main entry ────────────────────────────────────────────────────────────────
export async function handleUpdate(cfg: Config, upd: Record<string, unknown>): Promise<void> {
  const cq = upd.callback_query as { id: string; data?: string; message?: { chat?: { id?: number } } } | undefined;
  if (cq) return handleCallback(cfg, cq);
  const msg = (upd.message || upd.edited_message) as { text?: string; chat?: { id?: number } } | undefined;
  const chatId = msg?.chat?.id;
  if (!chatId) return;
  const chat = String(chatId);
  const text = (msg?.text || "").trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");

  if (/^\/start/.test(cmd)) {
    if (arg) { // deep-link token
      const sub = await store.bindTelegramByToken(arg, chat);
      if (sub) return void sendTelegram(cfg, chat, "✅ <b>Linked!</b> You'll get your tender alerts here.", menuKeyboard());
    }
    return void sendTelegram(cfg, chat, WELCOME(!!(await store.getSubscriberByChat(chat))), menuKeyboard());
  }
  if (/^\/(menu)$/.test(cmd)) return void sendTelegram(cfg, chat, "What would you like to do?", menuKeyboard());
  if (/^\/(help)$/.test(cmd)) return void sendTelegram(cfg, chat, HELP, menuKeyboard());
  if (/^\/(about)$/.test(cmd)) return void sendTelegram(cfg, chat, "Qellal aggregates every public Ethiopian tender notice. tenders.qelal.et", menuKeyboard());
  if (/^\/(search)$/.test(cmd)) return void (arg ? search(cfg, chat, arg) : sendTelegram(cfg, chat, "Send a keyword to search, e.g. <code>/search electrical</code> — or just type it."));
  if (/^\/(latest)$/.test(cmd)) return void browse(cfg, chat, "latest");
  if (/^\/(closing)$/.test(cmd)) return void browse(cfg, chat, "closing");
  if (/^\/(today)$/.test(cmd)) return void browse(cfg, chat, "today");
  if (/^\/(stats)$/.test(cmd)) { const ins = await store.insights(); return void sendTelegram(cfg, chat, `📈 <b>Qellal</b>\n\nSubscribers: <b>${ins.subscribers}</b> · Alerts: <b>${ins.alerts}</b>`); }
  if (/^\/(alerts)$/.test(cmd)) return void alertsList(cfg, chat);
  if (/^\/(status)$/.test(cmd)) return void sendTelegram(cfg, chat, await statusText(cfg, await store.getSubscriberByChat(chat)));
  if (/^\/(pause)$/.test(cmd)) return void setPause(cfg, chat, 7);
  if (/^\/(resume)$/.test(cmd)) return void setPause(cfg, chat, 0);
  if (/^\/(digest)$/.test(cmd)) return void toggleDigest(cfg, chat);
  if (/^\/(stop|unlink)$/.test(cmd)) { await store.unlinkTelegramByChat(chat); return void sendTelegram(cfg, chat, "🔕 Unlinked. Re-link anytime from the My alerts page."); }
  if (cmd.startsWith("/")) return void sendTelegram(cfg, chat, "Unknown command. /help for options.", menuKeyboard());

  // Plain text → search
  if (text) return void search(cfg, chat, text);
}

async function handleCallback(cfg: Config, cq: { id: string; data?: string; message?: { chat?: { id?: number } } }) {
  const chatId = cq.message?.chat?.id;
  const data = cq.data || "";
  await answerCallback(cfg, cq.id);
  if (!chatId) return;
  const chat = String(chatId);
  if (data === "menu") return void sendTelegram(cfg, chat, "What would you like to do?", menuKeyboard());
  if (data === "help") return void sendTelegram(cfg, chat, HELP, menuKeyboard());
  if (data === "search") return void sendTelegram(cfg, chat, "🔍 Type a keyword to search (e.g. <i>construction</i>).");
  if (data === "latest") return void browse(cfg, chat, "latest");
  if (data === "closing") return void browse(cfg, chat, "closing");
  if (data === "today") return void browse(cfg, chat, "today");
  if (data === "alerts") return void alertsList(cfg, chat);
  if (data === "settings") return void sendTelegram(cfg, chat, "⚙️ <b>Settings</b>", settingsKeyboard(await store.getSubscriberByChat(chat)));
  if (data === "pause") return void setPause(cfg, chat, 7);
  if (data === "resume") return void setPause(cfg, chat, 0);
  if (data === "digest") return void toggleDigest(cfg, chat);
  if (data === "unlink") { await store.unlinkTelegramByChat(chat); return void sendTelegram(cfg, chat, "🔕 Unlinked."); }
  if (data.startsWith("more:")) { const [, q, off] = data.split(":"); return void search(cfg, chat, q, Number(off) || 0); }
  if (data.startsWith("alert:")) return void createAlertFromQuery(cfg, chat, data.slice(6));
  if (data.startsWith("del:")) return void delAlert(cfg, chat, Number(data.slice(4)));
}

async function alertsList(cfg: Config, chat: string) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void sendTelegram(cfg, chat, "Link this chat first (My alerts page → “Link Telegram”).", menuKeyboard());
  const alerts = await store.listAlerts(sub.member_uuid);
  if (!alerts.length) return void sendTelegram(cfg, chat, "You have no alerts yet. Search for something and tap “🔔 Alert me”.", menuKeyboard());
  const rows = alerts.map((a) => [{ text: `🗑 ${a.label.slice(0, 30)}`, callback_data: `del:${a.id}` }]);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  await sendTelegram(cfg, chat, `🔔 <b>Your alerts</b> (tap to delete)\n\n${alerts.map((a) => "• " + esc(a.label)).join("\n")}`, { inline_keyboard: rows });
}
async function createAlertFromQuery(cfg: Config, chat: string, q: string) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void sendTelegram(cfg, chat, "Link this chat first to save alerts (My alerts page → “Link Telegram”).");
  await store.createAlert(sub.member_uuid, `"${q}"`, { q }, { email: true, telegram: true });
  await sendTelegram(cfg, chat, `✅ Alert saved for "<b>${esc(q)}</b>". You'll get new matches here.`, menuKeyboard());
}
async function delAlert(cfg: Config, chat: string, id: number) {
  const sub = await store.getSubscriberByChat(chat);
  if (sub && id) await store.deleteAlert(sub.member_uuid, id);
  await alertsList(cfg, chat);
}
async function setPause(cfg: Config, chat: string, days: number) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void sendTelegram(cfg, chat, "Link this chat first.");
  await store.setPrefs(sub.member_uuid, { paused_until: days > 0 ? new Date(Date.now() + days * 86400000) : null });
  await sendTelegram(cfg, chat, days > 0 ? `⏸ Paused for ${days} days.` : "▶️ Resumed.", settingsKeyboard(await store.getSubscriberByChat(chat)));
}
async function toggleDigest(cfg: Config, chat: string) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void sendTelegram(cfg, chat, "Link this chat first.");
  await store.setPrefs(sub.member_uuid, { digest_mode: !sub.digest_mode });
  await sendTelegram(cfg, chat, !sub.digest_mode ? "📬 Daily digest ON — one summary per day." : "⚡ Instant alerts ON.", settingsKeyboard(await store.getSubscriberByChat(chat)));
}
