// Notifier data store — a self-contained SQLite file (NOTIFY_DB_PATH, default
// /opt/tender-notify/data.db). Holds subscribers, their saved alerts, an
// idempotent send-log, and operator settings (edited on the admin page). Nothing
// here touches Ghost's database. Functions stay async so callers are unchanged.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Subscriber = {
  member_uuid: string;
  email: string | null;
  telegram_chat_id: string | null;
  telegram_link_token: string | null;
  digest_mode: number;
  paused_until: string | null;
  lang?: string;
  digest_freq?: string;
};
export type SavedTender = { tender_id: string; url: string | null; title: string | null; deadline: string | null };
export type Criteria = { q?: string; cat?: string; catName?: string; region?: string; deadline?: string; closed?: string };
export type Channels = { email?: boolean; telegram?: boolean };
export type Alert = { id: number; member_uuid: string; label: string; criteria: Criteria; channels: Channels; created_at: string; snoozed_until?: string | null };

let db: Database.Database | null = null;

export async function initStore(): Promise<void> {
  if (db) return;
  const path = process.env.NOTIFY_DB_PATH || "/opt/tender-notify/data.db";
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* exists */ }
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      member_uuid TEXT PRIMARY KEY,
      email TEXT, telegram_chat_id TEXT, telegram_link_token TEXT,
      digest_mode INTEGER NOT NULL DEFAULT 0,
      paused_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_uuid TEXT NOT NULL,
      label TEXT NOT NULL,
      criteria_json TEXT NOT NULL,
      channels_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_member ON alerts(member_uuid);
    CREATE TABLE IF NOT EXISTS sent_log (
      member_uuid TEXT NOT NULL, tender_id TEXT NOT NULL, kind TEXT NOT NULL, channel TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (member_uuid, tender_id, kind, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_sent_at ON sent_log(sent_at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS saved_tenders (
      member_uuid TEXT NOT NULL, tender_id TEXT NOT NULL, url TEXT, title TEXT, deadline TEXT,
      saved_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (member_uuid, tender_id)
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, member_uuid TEXT, chat_id TEXT, text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bot_events (name TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
  `);
  // Additive columns for pre-existing installs (ignore "duplicate column").
  for (const sql of [
    "ALTER TABLE subscribers ADD COLUMN lang TEXT DEFAULT 'en'",
    "ALTER TABLE subscribers ADD COLUMN digest_freq TEXT DEFAULT 'daily'",
    "ALTER TABLE alerts ADD COLUMN snoozed_until TEXT",
  ]) { try { db!.exec(sql); } catch { /* already exists */ } }
}
function d(): Database.Database {
  if (!db) throw new Error("store not initialised — call initStore() first");
  return db;
}
const asUTC = (s: string | null): Date | null => (s ? new Date(s.replace(" ", "T") + "Z") : null);

// ── settings ─────────────────────────────────────────────────────────────────
export async function getSettings(): Promise<Record<string, string>> {
  const rows = d().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
export async function setSetting(key: string, value: string | null): Promise<void> {
  d().prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(key, value);
}

// ── subscribers ──────────────────────────────────────────────────────────────
export async function upsertSubscriber(uuid: string, email: string | null): Promise<void> {
  d().prepare("INSERT INTO subscribers (member_uuid, email) VALUES (?, ?) ON CONFLICT(member_uuid) DO UPDATE SET email = excluded.email").run(uuid, email);
}
export async function getSubscriber(uuid: string): Promise<Subscriber | null> {
  return (d().prepare("SELECT * FROM subscribers WHERE member_uuid = ?").get(uuid) as Subscriber) || null;
}
export async function getSubscriberByChat(chatId: string): Promise<Subscriber | null> {
  return (d().prepare("SELECT * FROM subscribers WHERE telegram_chat_id = ?").get(chatId) as Subscriber) || null;
}
export async function setLinkToken(uuid: string, token: string): Promise<void> {
  d().prepare("UPDATE subscribers SET telegram_link_token = ? WHERE member_uuid = ?").run(token, uuid);
}
export async function bindTelegramByToken(token: string, chatId: string): Promise<Subscriber | null> {
  const row = d().prepare("SELECT member_uuid FROM subscribers WHERE telegram_link_token = ?").get(token) as { member_uuid: string } | undefined;
  if (!row) return null;
  d().prepare("UPDATE subscribers SET telegram_chat_id = ?, telegram_link_token = NULL WHERE member_uuid = ?").run(chatId, row.member_uuid);
  return getSubscriber(row.member_uuid);
}
export async function unlinkTelegramByChat(chatId: string): Promise<void> {
  d().prepare("UPDATE subscribers SET telegram_chat_id = NULL WHERE telegram_chat_id = ?").run(chatId);
}
export async function setPrefs(uuid: string, prefs: { digest_mode?: boolean; paused_until?: Date | null }): Promise<void> {
  if (prefs.digest_mode !== undefined) d().prepare("UPDATE subscribers SET digest_mode = ? WHERE member_uuid = ?").run(prefs.digest_mode ? 1 : 0, uuid);
  if (prefs.paused_until !== undefined) d().prepare("UPDATE subscribers SET paused_until = ? WHERE member_uuid = ?").run(prefs.paused_until ? prefs.paused_until.toISOString() : null, uuid);
}

// ── alerts ───────────────────────────────────────────────────────────────────
type AlertRow = { id: number; member_uuid: string; label: string; criteria_json: string; channels_json: string; created_at: string; snoozed_until?: string | null };
function toAlert(r: AlertRow): Alert {
  return { id: r.id, member_uuid: r.member_uuid, label: r.label, criteria: JSON.parse(r.criteria_json || "{}"), channels: JSON.parse(r.channels_json || "{}"), created_at: r.created_at, snoozed_until: r.snoozed_until ?? null };
}
export async function listAlerts(uuid: string): Promise<Alert[]> {
  return (d().prepare("SELECT * FROM alerts WHERE member_uuid = ? ORDER BY created_at DESC").all(uuid) as AlertRow[]).map(toAlert);
}
export async function allAlerts(): Promise<(Alert & { subscriber: Subscriber })[]> {
  const rows = d().prepare(
    "SELECT a.*, s.email, s.telegram_chat_id, s.digest_mode, s.paused_until FROM alerts a JOIN subscribers s ON s.member_uuid = a.member_uuid",
  ).all() as (AlertRow & { email: string | null; telegram_chat_id: string | null; digest_mode: number; paused_until: string | null })[];
  return rows.map((r) => ({
    ...toAlert(r),
    subscriber: { member_uuid: r.member_uuid, email: r.email, telegram_chat_id: r.telegram_chat_id, telegram_link_token: null, digest_mode: r.digest_mode, paused_until: r.paused_until },
  }));
}
export async function createAlert(uuid: string, label: string, criteria: Criteria, channels: Channels): Promise<number> {
  const info = d().prepare("INSERT INTO alerts (member_uuid, label, criteria_json, channels_json) VALUES (?, ?, ?, ?)").run(uuid, label.slice(0, 255), JSON.stringify(criteria), JSON.stringify(channels));
  return Number(info.lastInsertRowid);
}
export async function deleteAlert(uuid: string, id: number): Promise<void> {
  d().prepare("DELETE FROM alerts WHERE id = ? AND member_uuid = ?").run(id, uuid);
}

// ── sent-log (idempotency) ───────────────────────────────────────────────────
export async function markSent(uuid: string, tenderId: string, kind: string, channel: string): Promise<boolean> {
  const info = d().prepare("INSERT OR IGNORE INTO sent_log (member_uuid, tender_id, kind, channel) VALUES (?, ?, ?, ?)").run(uuid, tenderId, kind, channel);
  return info.changes > 0; // true = first time (not sent before)
}
export async function unmarkSent(uuid: string, tenderId: string, kind: string, channel: string): Promise<void> {
  d().prepare("DELETE FROM sent_log WHERE member_uuid = ? AND tender_id = ? AND kind = ? AND channel = ?").run(uuid, tenderId, kind, channel);
}
export async function lastDigestAt(uuid: string): Promise<Date | null> {
  const r = d().prepare("SELECT MAX(sent_at) m FROM sent_log WHERE member_uuid = ? AND kind = 'digest'").get(uuid) as { m: string | null };
  return asUTC(r?.m || null);
}
export async function sentCountToday(uuid: string): Promise<number> {
  const r = d().prepare("SELECT COUNT(*) c FROM sent_log WHERE member_uuid = ? AND date(sent_at) = date('now')").get(uuid) as { c: number };
  return Number(r?.c || 0);
}

// ── personalization ──────────────────────────────────────────────────────────
export async function setLang(uuid: string, lang: string): Promise<void> {
  d().prepare("UPDATE subscribers SET lang = ? WHERE member_uuid = ?").run(lang, uuid);
}
export async function setDigestFreq(uuid: string, freq: string): Promise<void> {
  d().prepare("UPDATE subscribers SET digest_freq = ? WHERE member_uuid = ?").run(freq, uuid);
}
export async function setAlertChannels(uuid: string, id: number, channels: Channels): Promise<void> {
  d().prepare("UPDATE alerts SET channels_json = ? WHERE id = ? AND member_uuid = ?").run(JSON.stringify(channels), id, uuid);
}
export async function snoozeAlert(uuid: string, id: number, until: Date | null): Promise<void> {
  d().prepare("UPDATE alerts SET snoozed_until = ? WHERE id = ? AND member_uuid = ?").run(until ? until.toISOString() : null, id, uuid);
}

// ── saved tenders (bookmarks + saved-tender reminders) ───────────────────────
export async function saveTender(uuid: string, t: { tender_id: string; url?: string; title?: string; deadline?: string | null }): Promise<void> {
  d().prepare("INSERT OR IGNORE INTO saved_tenders (member_uuid, tender_id, url, title, deadline) VALUES (?, ?, ?, ?, ?)").run(uuid, t.tender_id, t.url || null, t.title || null, t.deadline || null);
}
export async function unsaveTender(uuid: string, tenderId: string): Promise<void> {
  d().prepare("DELETE FROM saved_tenders WHERE member_uuid = ? AND tender_id = ?").run(uuid, tenderId);
}
export async function isSaved(uuid: string, tenderId: string): Promise<boolean> {
  return !!d().prepare("SELECT 1 FROM saved_tenders WHERE member_uuid = ? AND tender_id = ?").get(uuid, tenderId);
}
export async function listSaved(uuid: string): Promise<SavedTender[]> {
  return d().prepare("SELECT tender_id, url, title, deadline FROM saved_tenders WHERE member_uuid = ? ORDER BY saved_at DESC LIMIT 25").all(uuid) as SavedTender[];
}
export async function allSavedWithSubscriber(): Promise<(SavedTender & { subscriber: Subscriber })[]> {
  const rows = d().prepare("SELECT st.*, s.* FROM saved_tenders st JOIN subscribers s ON s.member_uuid = st.member_uuid").all() as (SavedTender & Subscriber)[];
  return rows.map((r) => ({ tender_id: r.tender_id, url: r.url, title: r.title, deadline: r.deadline, subscriber: r as unknown as Subscriber }));
}

// ── feedback ─────────────────────────────────────────────────────────────────
export async function addFeedback(uuid: string | null, chat: string | null, text: string): Promise<void> {
  d().prepare("INSERT INTO feedback (member_uuid, chat_id, text) VALUES (?, ?, ?)").run(uuid, chat, text.slice(0, 1000));
}
export async function listFeedback(): Promise<{ id: number; text: string; created_at: string }[]> {
  return d().prepare("SELECT id, text, created_at FROM feedback ORDER BY id DESC LIMIT 30").all() as { id: number; text: string; created_at: string }[];
}

// ── bot usage counters + broadcast ───────────────────────────────────────────
export async function bumpEvent(name: string): Promise<void> {
  d().prepare("INSERT INTO bot_events (name, count) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET count = count + 1").run(name);
}
export async function getEvents(): Promise<{ name: string; count: number }[]> {
  return d().prepare("SELECT name, count FROM bot_events ORDER BY count DESC LIMIT 20").all() as { name: string; count: number }[];
}
export async function allChatIds(): Promise<string[]> {
  return (d().prepare("SELECT telegram_chat_id c FROM subscribers WHERE telegram_chat_id IS NOT NULL").all() as { c: string }[]).map((r) => r.c);
}

// ── insights (admin page) ────────────────────────────────────────────────────
export async function insights(): Promise<Record<string, unknown>> {
  const g = <T>(sql: string, ...p: unknown[]) => d().prepare(sql).get(...(p as [])) as T;
  const a = <T>(sql: string) => d().prepare(sql).all() as T[];
  const subs = g<{ c: number; tg: number }>("SELECT COUNT(*) c, SUM(telegram_chat_id IS NOT NULL) tg FROM subscribers");
  return {
    subscribers: Number(subs?.c || 0),
    telegramLinked: Number(subs?.tg || 0),
    alerts: Number(g<{ c: number }>("SELECT COUNT(*) c FROM alerts")?.c || 0),
    sends7d: Number(g<{ c: number }>("SELECT COUNT(*) c FROM sent_log WHERE sent_at >= datetime('now','-7 days')")?.c || 0),
    sendsToday: Number(g<{ c: number }>("SELECT COUNT(*) c FROM sent_log WHERE date(sent_at) = date('now')")?.c || 0),
    topCategories: a<{ k: string; c: number }>("SELECT json_extract(criteria_json,'$.catName') k, COUNT(*) c FROM alerts WHERE k IS NOT NULL GROUP BY k ORDER BY c DESC LIMIT 8").map((r) => ({ key: r.k, count: Number(r.c) })),
    topRegions: a<{ k: string; c: number }>("SELECT json_extract(criteria_json,'$.region') k, COUNT(*) c FROM alerts WHERE k IS NOT NULL GROUP BY k ORDER BY c DESC LIMIT 8").map((r) => ({ key: r.k, count: Number(r.c) })),
    savedTenders: Number(g<{ c: number }>("SELECT COUNT(*) c FROM saved_tenders")?.c || 0),
    feedbackCount: Number(g<{ c: number }>("SELECT COUNT(*) c FROM feedback")?.c || 0),
    events: a<{ name: string; count: number }>("SELECT name, count FROM bot_events ORDER BY count DESC LIMIT 15").map((r) => ({ name: r.name, count: Number(r.count) })),
    recent: a("SELECT member_uuid, tender_id, kind, channel, sent_at FROM sent_log ORDER BY sent_at DESC LIMIT 20"),
  };
}
