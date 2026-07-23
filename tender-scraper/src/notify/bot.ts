// Conversational Telegram bot for Qellal tenders.
// Commands, inline menus, live search, category/region/trending browse, random,
// per-tender cards (open/save/calendar/share/similar), in-chat alert management
// (create from search or sector, snooze, per-alert channels, digest frequency,
// pause/mute), saved bookmarks, language (EN/AM), feedback, invite, analytics.
// Callbacks edit the message in place; commands send a new one. Rate-limited.

import type { Config } from "./config";
import * as store from "./store";
import { queryMeili, todayStartTs, facet, getById, type MeiliHit } from "./match";
import { sendTelegram, editTelegram, answerCallback, type InlineKeyboard } from "./senders/telegram";

const PAGE = 5;
const esc = (s: string) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const c55 = (s: string) => s.slice(0, 55); // category/region names (ASCII) fit the 64-byte callback
const lastQ = new Map<string, string>(); // last search per chat (avoids unsafe callback_data)

// A reply either edits the triggering message (callbacks) or sends a new one (commands).
type Reply = (text: string, kb?: InlineKeyboard) => Promise<void>;

// Per-chat rate limit: 25 actions / 10s (drops floods without crashing).
const rate = new Map<string, { n: number; t: number }>();
function limited(chat: string): boolean {
  const now = Date.now(), e = rate.get(chat);
  if (!e || now > e.t) { rate.set(chat, { n: 1, t: now + 10000 }); return false; }
  e.n += 1; return e.n > 25;
}
function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export const BOT_COMMANDS = [
  { command: "menu", description: "Main menu" },
  { command: "search", description: "Search tenders by keyword" },
  { command: "latest", description: "Newest tenders" },
  { command: "closing", description: "Closing this week" },
  { command: "today", description: "Closing today" },
  { command: "categories", description: "Browse by sector" },
  { command: "regions", description: "Browse by region" },
  { command: "trending", description: "Top sectors" },
  { command: "random", description: "A random tender" },
  { command: "alerts", description: "My saved alerts" },
  { command: "newalert", description: "Create a sector alert" },
  { command: "saved", description: "My bookmarked tenders" },
  { command: "digest", description: "Instant / daily / weekly delivery" },
  { command: "pause", description: "Pause alerts for 7 days" },
  { command: "resume", description: "Resume alerts" },
  { command: "language", description: "English / አማርኛ" },
  { command: "status", description: "My subscription status" },
  { command: "invite", description: "Share this bot" },
  { command: "feedback", description: "Send feedback to the team" },
  { command: "help", description: "How this bot works" },
  { command: "stop", description: "Unlink this chat" },
];

type L = "en" | "am";
const T: Record<L, Record<string, string>> = {
  en: { menuq: "What would you like to do?", search: "🔍 Search", closing: "📅 Closing soon", latest: "🆕 Latest", myalerts: "🔔 My alerts", sectors: "🏷 Sectors", regions: "🗺 Regions", settings: "⚙️ Settings", help: "ℹ️ Help", back: "⬅️ Menu", saved: "💾 Saved" },
  am: { menuq: "ምን ማድረግ ይፈልጋሉ?", search: "🔍 ፍለጋ", closing: "📅 በቅርቡ የሚዘጉ", latest: "🆕 አዲስ", myalerts: "🔔 ማንቂያዎቼ", sectors: "🏷 ዘርፎች", regions: "🗺 ክልሎች", settings: "⚙️ ቅንብሮች", help: "ℹ️ እገዛ", back: "⬅️ ዝርዝር", saved: "💾 የተቀመጡ" },
};
const trx = (l: L, k: string) => T[l]?.[k] ?? T.en[k] ?? k;

function menuKeyboard(l: L): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: trx(l, "search"), callback_data: "search" }, { text: trx(l, "closing"), callback_data: "closing" }],
    [{ text: trx(l, "latest"), callback_data: "latest" }, { text: trx(l, "sectors"), callback_data: "cats" }],
    [{ text: trx(l, "myalerts"), callback_data: "alerts" }, { text: trx(l, "saved"), callback_data: "saved" }],
    [{ text: trx(l, "settings"), callback_data: "settings" }, { text: trx(l, "help"), callback_data: "help" }],
  ] };
}
function settingsKeyboard(sub: store.Subscriber | null): InlineKeyboard {
  const paused = sub?.paused_until && new Date(sub.paused_until).getTime() > Date.now();
  const freq = sub?.digest_freq || (sub?.digest_mode ? "daily" : "instant");
  return { inline_keyboard: [
    [{ text: `📬 Delivery: ${freq}`, callback_data: "freq" }],
    [paused ? { text: "▶️ Resume", callback_data: "resume" } : { text: "⏸ Pause 7d", callback_data: "pause" }, { text: "🔇 Mute 24h", callback_data: "mute" }],
    [{ text: "🌐 EN / አማርኛ", callback_data: "lang" }, { text: "🔕 Unlink", callback_data: "unlink" }],
    [{ text: "⬅️ Menu", callback_data: "menu" }],
  ] };
}
function metaOf(h: MeiliHit): string {
  const p: string[] = [];
  if (h.deadline) { const d = Math.round((Date.parse(h.deadline) / 1000 - todayStartTs()) / 86400); p.push(d < 0 ? "closed" : d === 0 ? "closes today" : `${d}d left`); }
  if (h.publishing_entity) p.push(h.publishing_entity);
  if (h.region) p.push(h.region);
  return p.join(" · ");
}
function renderList(l: L, title: string, hits: MeiliHit[], opts: { q?: string; offset?: number; alertCb?: string } = {}): { text: string; keyboard: InlineKeyboard } {
  const offset = opts.offset || 0;
  if (!hits.length) return { text: `${title}\n\nNo tenders found.`, keyboard: menuKeyboard(l) };
  const lines = hits.map((h, i) => `${offset + i + 1}. <b>${esc(h.title.slice(0, 90))}</b>\n   <i>${esc(metaOf(h))}</i>`);
  const rows: { text: string; callback_data?: string; url?: string }[][] = [];
  rows.push(hits.map((h, i) => ({ text: `${offset + i + 1}`, callback_data: `t:${h.id}` })));
  if (opts.alertCb) rows.push([{ text: "🔔 Alert me for this", callback_data: opts.alertCb }]);
  const nav: { text: string; callback_data: string }[] = [];
  if (offset > 0 && opts.q != null) nav.push({ text: "‹ Prev", callback_data: `more:${Math.max(0, offset - PAGE)}` });
  if (hits.length === PAGE && opts.q != null) nav.push({ text: "More ›", callback_data: `more:${offset + PAGE}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: trx(l, "back"), callback_data: "menu" }]);
  return { text: `${title}\n\n${lines.join("\n\n")}`, keyboard: { inline_keyboard: rows } };
}

async function tenderCard(cfg: Config, chat: string, l: L, r: Reply, id: string) {
  const h = await getById(cfg, id);
  if (!h) return void r("Tender not found (it may have been removed).", menuKeyboard(l));
  const sub = await store.getSubscriberByChat(chat);
  const saved = sub ? await store.isSaved(sub.member_uuid, id) : false;
  const kb: InlineKeyboard = { inline_keyboard: [
    [{ text: "🌐 Open", url: h.url }, { text: saved ? "✅ Saved" : "💾 Save", callback_data: `${saved ? "unsave" : "save"}:${id}` }],
    [{ text: "📅 Calendar", url: `${cfg.siteUrl}/ghost/alerts/ics/${encodeURIComponent(id)}` }, { text: "🔗 Share", url: `https://t.me/share/url?url=${encodeURIComponent(h.url)}` }],
    [{ text: "🔍 Similar", callback_data: `sim:${id}` }, { text: "⬅️ Menu", callback_data: "menu" }],
  ] };
  await r(`<b>${esc(h.title)}</b>\n<i>${esc(metaOf(h))}</i>\n\n💡 Save it for 7/3/1-day deadline reminders here.`, kb);
}
async function search(cfg: Config, chat: string, l: L, r: Reply, q: string, offset = 0) {
  lastQ.set(chat, q);
  const hits = await queryMeili(cfg, { q }, { limit: PAGE, offset });
  const out = renderList(l, `🔍 Results for "<b>${esc(q)}</b>"`, hits, { q, offset, alertCb: "alertq" });
  await r(out.text, out.keyboard);
}
async function browse(cfg: Config, chat: string, l: L, r: Reply, mode: "latest" | "closing" | "today") {
  let hits: MeiliHit[] = [], title = "";
  if (mode === "latest") { hits = await queryMeili(cfg, {}, { sort: ["published_ts:desc"], limit: PAGE }); title = "🆕 <b>Latest tenders</b>"; }
  else if (mode === "closing") { hits = await queryMeili(cfg, { deadline: "7" }, { sort: ["open_rank:asc", "deadline_ts:asc"], limit: PAGE }); title = "📅 <b>Closing this week</b>"; }
  else { hits = await queryMeili(cfg, {}, { deadlineDay: todayStartTs(), sort: ["deadline_ts:asc"], limit: PAGE }); title = "⏰ <b>Closing today</b>"; }
  const out = renderList(l, title, hits);
  await r(out.text, out.keyboard);
}
async function browseCategory(cfg: Config, chat: string, l: L, r: Reply, name: string) {
  const hits = await queryMeili(cfg, { catName: name }, { sort: ["open_rank:asc", "deadline_ts:asc"], limit: PAGE });
  const out = renderList(l, `🏷 <b>${esc(name)}</b>`, hits, { alertCb: `acat:${c55(name)}` });
  await r(out.text, out.keyboard);
}
async function browseRegion(cfg: Config, chat: string, l: L, r: Reply, name: string) {
  const hits = await queryMeili(cfg, { region: name }, { sort: ["open_rank:asc", "deadline_ts:asc"], limit: PAGE });
  const out = renderList(l, `🗺 <b>${esc(name)}</b>`, hits, { alertCb: `areg:${c55(name)}` });
  await r(out.text, out.keyboard);
}
async function similar(cfg: Config, chat: string, l: L, r: Reply, id: string) {
  const h = await getById(cfg, id);
  const cat = h?.categories?.[0];
  if (!cat) return void r("No similar tenders found.", menuKeyboard(l));
  await browseCategory(cfg, chat, l, r, cat);
}
async function categoriesKeyboard(cfg: Config, prefix: string): Promise<InlineKeyboard> {
  const cats = await facet(cfg, "categories", 12);
  const rows = cats.map((c) => [{ text: `${c.value} (${c.count})`.slice(0, 40), callback_data: `${prefix}:${c55(c.value)}` }]);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}
async function regionsKeyboard(cfg: Config): Promise<InlineKeyboard> {
  const regs = await facet(cfg, "region", 14);
  const rows = regs.map((rg) => [{ text: `${rg.value} (${rg.count})`.slice(0, 40), callback_data: `reg:${c55(rg.value)}` }]);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}
async function alertsList(cfg: Config, chat: string, l: L, r: Reply) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void r("Link this chat first (My alerts page → “Link Telegram”).", menuKeyboard(l));
  const alerts = await store.listAlerts(sub.member_uuid);
  if (!alerts.length) return void r("No alerts yet. Search or pick a sector, then tap “🔔 Alert me”.", menuKeyboard(l));
  const rows = alerts.map((a) => [{ text: `⚙️ ${a.label.slice(0, 28)}`, callback_data: `a:${a.id}` }]);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  await r("🔔 <b>Your alerts</b> — tap to manage", { inline_keyboard: rows });
}
async function alertDetail(cfg: Config, chat: string, l: L, r: Reply, id: number) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return;
  const a = (await store.listAlerts(sub.member_uuid)).find((x) => x.id === id);
  if (!a) return void alertsList(cfg, chat, l, r);
  const snoozed = a.snoozed_until && new Date(a.snoozed_until).getTime() > Date.now();
  const kb: InlineKeyboard = { inline_keyboard: [
    [{ text: a.channels.email ? "📧 Email: ON" : "📧 Email: OFF", callback_data: `chE:${id}` }, { text: a.channels.telegram ? "📨 Telegram: ON" : "📨 Telegram: OFF", callback_data: `chT:${id}` }],
    [snoozed ? { text: "🔔 Unsnooze", callback_data: `snz:${id}:0` } : { text: "😴 Snooze 7d", callback_data: `snz:${id}:7` }],
    [{ text: "🗑 Delete", callback_data: `del:${id}` }, { text: "⬅️ Alerts", callback_data: "alerts" }],
  ] };
  await r(`🔔 <b>${esc(a.label)}</b>\n${snoozed ? `Snoozed until ${new Date(a.snoozed_until as string).toLocaleDateString()}` : "Active"}`, kb);
}
async function savedList(cfg: Config, chat: string, l: L, r: Reply) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void r("Link this chat first to bookmark tenders.", menuKeyboard(l));
  const saved = await store.listSaved(sub.member_uuid);
  if (!saved.length) return void r("No bookmarks yet. Open any tender and tap 💾 Save.", menuKeyboard(l));
  const lines = saved.map((s, i) => `${i + 1}. <a href="${esc(s.url || "")}">${esc((s.title || s.tender_id).slice(0, 80))}</a>`);
  const rows = saved.map((s, i) => [{ text: `🗑 ${i + 1}`, callback_data: `unsave:${s.tender_id}` }]);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  await r(`💾 <b>Your saved tenders</b>\n\n${lines.join("\n")}`, { inline_keyboard: rows });
}
async function createAlert(cfg: Config, chat: string, l: L, r: Reply, label: string, criteria: store.Criteria) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void r("Link this chat first to save alerts (My alerts page → “Link Telegram”).");
  await store.createAlert(sub.member_uuid, label, criteria, { email: true, telegram: true });
  await r(`✅ Alert saved: <b>${esc(label)}</b>. New matches will arrive here.`, menuKeyboard(l));
}
async function statusText(sub: store.Subscriber | null): Promise<string> {
  if (!sub) return "This chat isn't linked. Open My alerts on the site and tap “Link Telegram”.";
  const alerts = await store.listAlerts(sub.member_uuid), saved = await store.listSaved(sub.member_uuid);
  const paused = sub.paused_until && new Date(sub.paused_until).getTime() > Date.now();
  return `📊 <b>Your status</b>\n\n• Alerts: <b>${alerts.length}</b> · Saved: <b>${saved.length}</b>\n• Delivery: <b>${sub.digest_freq || (sub.digest_mode ? "daily" : "instant")}</b>\n• ${paused ? `Paused until ${new Date(sub.paused_until as string).toLocaleDateString()}` : "Active"}\n• Email: ${esc(sub.email || "—")}`;
}
async function setPause(cfg: Config, chat: string, r: Reply, days: number) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void r("Link this chat first.");
  await store.setPrefs(sub.member_uuid, { paused_until: days > 0 ? new Date(Date.now() + days * 86400000) : null });
  await r(days > 1 ? `⏸ Paused ${days} days.` : days === 1 ? "🔇 Muted 24h." : "▶️ Resumed.", settingsKeyboard(await store.getSubscriberByChat(chat)));
}
async function cycleFreq(cfg: Config, chat: string, r: Reply) {
  const sub = await store.getSubscriberByChat(chat);
  if (!sub) return void r("Link this chat first.");
  const order = ["instant", "daily", "weekly"];
  const next = order[(order.indexOf(sub.digest_freq || (sub.digest_mode ? "daily" : "instant")) + 1) % order.length];
  await store.setDigestFreq(sub.member_uuid, next);
  await store.setPrefs(sub.member_uuid, { digest_mode: next !== "instant" });
  await r(`📬 Delivery set to <b>${next}</b>.`, settingsKeyboard(await store.getSubscriberByChat(chat)));
}
async function toggleLang(cfg: Config, chat: string, r: Reply) {
  const sub = await store.getSubscriberByChat(chat);
  const next: L = (sub?.lang as L) === "am" ? "en" : "am";
  if (sub) await store.setLang(sub.member_uuid, next);
  await r(next === "am" ? "🌐 ቋንቋ ወደ አማርኛ ተቀይሯል።" : "🌐 Language set to English.", menuKeyboard(next));
}

const WELCOME = (linked: boolean) =>
  `👋 <b>Qellal tender alerts</b>\n\nSearch every Ethiopian tender, browse by sector/region, and get pinged when new tenders match you.\n\n• <b>Type a keyword</b> to search (e.g. <i>electrical</i>)\n• /closing · /latest · /categories · /trending\n• /alerts · /saved\n\n${linked ? "✅ This chat is linked." : "🔗 Link from tenders.qelal.et/my-alerts to save alerts."}`;
const HELP =
  `ℹ️ <b>How this bot works</b>\n\n<b>Search</b> — type a keyword, or /search\n<b>Browse</b> — /latest /closing /today /categories /regions /trending /random\n<b>Tender card</b> — tap a result number → Open, 💾 Save, 📅 Calendar, 🔗 Share, 🔍 Similar\n<b>Alerts</b> — save any search/sector; new matches + 7/3/1-day reminders arrive here. /alerts to manage.\n<b>Settings</b> — /digest (instant/daily/weekly), /pause, /language, /stop\n<b>/feedback</b> — tell us anything.\nManage on the web: tenders.qelal.et/my-alerts`;

// ── entry ────────────────────────────────────────────────────────────────────
export async function handleUpdate(cfg: Config, upd: Record<string, unknown>): Promise<void> {
  const cq = upd.callback_query as { id: string; data?: string; message?: { chat?: { id?: number }; message_id?: number } } | undefined;
  if (cq) return handleCallback(cfg, cq);
  const msg = (upd.message || upd.edited_message) as { text?: string; chat?: { id?: number } } | undefined;
  const chatId = msg?.chat?.id;
  if (!chatId) return;
  const chat = String(chatId);
  if (limited(chat)) return;
  const sub = await store.getSubscriberByChat(chat);
  const l = (sub?.lang as L) || "en";
  const r: Reply = (t, kb) => sendTelegram(cfg, chat, t, kb).catch(() => {});
  const text = (msg?.text || "").trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  if (cmd.startsWith("/")) store.bumpEvent(cmd.replace(/^\//, "").replace(/@.*/, "")).catch(() => {});

  if (/^\/start/.test(cmd)) {
    if (arg && !arg.startsWith("ref")) { const s = await store.bindTelegramByToken(arg, chat); if (s) return void r("✅ <b>Linked!</b> You'll get your tender alerts here.", menuKeyboard(l)); }
    return void r(WELCOME(!!sub), menuKeyboard(l));
  }
  if (/^\/menu$/.test(cmd)) return void r(trx(l, "menuq"), menuKeyboard(l));
  if (/^\/help$/.test(cmd)) return void r(HELP, menuKeyboard(l));
  if (/^\/search$/.test(cmd)) return void (arg ? search(cfg, chat, l, r, arg) : r("Send a keyword, e.g. <code>/search electrical</code> — or just type it."));
  if (/^\/latest$/.test(cmd)) return void browse(cfg, chat, l, r, "latest");
  if (/^\/closing$/.test(cmd)) return void browse(cfg, chat, l, r, "closing");
  if (/^\/today$/.test(cmd)) return void browse(cfg, chat, l, r, "today");
  if (/^\/categories$/.test(cmd)) return void r("🏷 <b>Pick a sector</b>", await categoriesKeyboard(cfg, "cat"));
  if (/^\/newalert$/.test(cmd)) return void r("🔔 <b>Alert me about a sector</b>", await categoriesKeyboard(cfg, "acat"));
  if (/^\/regions$/.test(cmd)) return void r("🗺 <b>Pick a region</b>", await regionsKeyboard(cfg));
  if (/^\/trending$/.test(cmd)) { const f = await facet(cfg, "categories", 8); return void r("📈 <b>Top sectors</b>\n\n" + f.map((c, i) => `${i + 1}. ${esc(c.value)} — <b>${c.count}</b>`).join("\n"), await categoriesKeyboard(cfg, "cat")); }
  if (/^\/random$/.test(cmd)) return void randomTender(cfg, chat, l, r);
  if (/^\/alerts$/.test(cmd)) return void alertsList(cfg, chat, l, r);
  if (/^\/saved$/.test(cmd)) return void savedList(cfg, chat, l, r);
  if (/^\/status$/.test(cmd)) return void r(await statusText(sub));
  if (/^\/pause$/.test(cmd)) return void setPause(cfg, chat, r, 7);
  if (/^\/resume$/.test(cmd)) return void setPause(cfg, chat, r, 0);
  if (/^\/digest$/.test(cmd)) return void cycleFreq(cfg, chat, r);
  if (/^\/language$/.test(cmd)) return void toggleLang(cfg, chat, r);
  if (/^\/invite$/.test(cmd)) return void r(`📣 Share Qellal tender alerts:\nhttps://t.me/${cfg.telegram.username || "qelalbot"}\nor the site: tenders.qelal.et`);
  if (/^\/feedback$/.test(cmd)) { if (!arg) return void r("Send feedback like: <code>/feedback your message</code>"); await store.addFeedback(sub?.member_uuid || null, chat, arg); return void r("🙏 Thanks — your feedback reached the team."); }
  if (/^\/(stop|unlink)$/.test(cmd)) { await store.unlinkTelegramByChat(chat); return void r("🔕 Unlinked. Re-link anytime from the My alerts page."); }
  if (cmd.startsWith("/")) return void r("Unknown command. /help for options.", menuKeyboard(l));
  if (text) return void search(cfg, chat, l, r, text);
}

async function randomTender(cfg: Config, chat: string, l: L, r: Reply) {
  let hit = (await queryMeili(cfg, {}, { limit: 1, offset: Math.floor(Math.random() * 300), sort: ["published_ts:desc"] }))[0];
  if (!hit) hit = (await queryMeili(cfg, {}, { limit: 1, offset: 0, sort: ["published_ts:desc"] }))[0];
  if (hit) return void tenderCard(cfg, chat, l, r, hit.id);
  await r("No tenders available right now.", menuKeyboard(l));
}

async function handleCallback(cfg: Config, cq: { id: string; data?: string; message?: { chat?: { id?: number }; message_id?: number } }) {
  const chatId = cq.message?.chat?.id;
  const data = cq.data || "";
  await answerCallback(cfg, cq.id);
  if (!chatId) return;
  const chat = String(chatId);
  if (limited(chat)) return;
  const msgId = cq.message?.message_id;
  const sub = await store.getSubscriberByChat(chat);
  const l = (sub?.lang as L) || "en";
  // Edit the message in place; fall back to a new message if the edit fails.
  const r: Reply = msgId
    ? (t, kb) => editTelegram(cfg, chat, msgId, t, kb).catch(() => sendTelegram(cfg, chat, t, kb).catch(() => {}))
    : (t, kb) => sendTelegram(cfg, chat, t, kb).catch(() => {});
  store.bumpEvent("cb:" + data.split(":")[0]).catch(() => {});

  if (data === "menu") return void r(trx(l, "menuq"), menuKeyboard(l));
  if (data === "help") return void r(HELP, menuKeyboard(l));
  if (data === "search") return void r("🔍 Type a keyword to search.");
  if (data === "latest") return void browse(cfg, chat, l, r, "latest");
  if (data === "closing") return void browse(cfg, chat, l, r, "closing");
  if (data === "today") return void browse(cfg, chat, l, r, "today");
  if (data === "cats") return void r("🏷 <b>Pick a sector</b>", await categoriesKeyboard(cfg, "cat"));
  if (data === "regs") return void r("🗺 <b>Pick a region</b>", await regionsKeyboard(cfg));
  if (data === "alerts") return void alertsList(cfg, chat, l, r);
  if (data === "saved") return void savedList(cfg, chat, l, r);
  if (data === "settings") return void r("⚙️ <b>Settings</b>", settingsKeyboard(sub));
  if (data === "pause") return void setPause(cfg, chat, r, 7);
  if (data === "mute") return void setPause(cfg, chat, r, 1);
  if (data === "resume") return void setPause(cfg, chat, r, 0);
  if (data === "freq") return void cycleFreq(cfg, chat, r);
  if (data === "lang") return void toggleLang(cfg, chat, r);
  if (data === "unlink") { await store.unlinkTelegramByChat(chat); return void r("🔕 Unlinked."); }
  if (data.startsWith("more:")) { const off = Number(data.slice(5)) || 0; const q = lastQ.get(chat); return void (q ? search(cfg, chat, l, r, q, off) : r("🔍 Please send your search again.")); }
  if (data === "alertq") { const q = lastQ.get(chat); return void (q ? createAlert(cfg, chat, l, r, `"${q}"`, { q }) : r("🔍 Search again, then tap “Alert me”.")); }
  if (data.startsWith("t:")) return void tenderCard(cfg, chat, l, r, data.slice(2));
  if (data.startsWith("sim:")) return void similar(cfg, chat, l, r, data.slice(4));
  if (data.startsWith("cat:")) return void browseCategory(cfg, chat, l, r, data.slice(4));
  if (data.startsWith("reg:")) return void browseRegion(cfg, chat, l, r, data.slice(4));
  if (data.startsWith("acat:")) { const n = data.slice(5); return void createAlert(cfg, chat, l, r, n, { cat: slugify(n), catName: n }); }
  if (data.startsWith("areg:")) { const n = data.slice(5); return void createAlert(cfg, chat, l, r, n, { region: n }); }
  if (data.startsWith("save:")) { if (!sub) return void r("Link this chat first to bookmark."); const h = await getById(cfg, data.slice(5)); if (h) await store.saveTender(sub.member_uuid, { tender_id: h.id, url: h.url, title: h.title, deadline: h.deadline }); return void tenderCard(cfg, chat, l, r, data.slice(5)); }
  if (data.startsWith("unsave:")) { if (sub) await store.unsaveTender(sub.member_uuid, data.slice(7)); return void tenderCard(cfg, chat, l, r, data.slice(7)); }
  if (data.startsWith("a:")) return void alertDetail(cfg, chat, l, r, Number(data.slice(2)));
  if (data.startsWith("del:")) { if (sub) await store.deleteAlert(sub.member_uuid, Number(data.slice(4))); return void alertsList(cfg, chat, l, r); }
  if (data.startsWith("snz:")) { const [, id, dd] = data.split(":"); if (sub) await store.snoozeAlert(sub.member_uuid, Number(id), Number(dd) > 0 ? new Date(Date.now() + Number(dd) * 86400000) : null); return void alertDetail(cfg, chat, l, r, Number(id)); }
  if (data.startsWith("chE:") || data.startsWith("chT:")) {
    const id = Number(data.slice(4)); if (!sub) return;
    const a = (await store.listAlerts(sub.member_uuid)).find((x) => x.id === id); if (!a) return;
    if (data.startsWith("chE:")) a.channels.email = !a.channels.email; else a.channels.telegram = !a.channels.telegram;
    await store.setAlertChannels(sub.member_uuid, id, a.channels);
    return void alertDetail(cfg, chat, l, r, id);
  }
}
