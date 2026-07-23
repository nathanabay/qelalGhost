// Notifier data store — a dedicated `tender_notify` MySQL database, separate
// from Ghost's schema. Holds subscribers, their saved alerts, an idempotent
// send-log, and operator settings (edited from the admin page).
//
//   NOTIFY_DB_HOST (default 127.0.0.1)  NOTIFY_DB_PORT (3306)
//   NOTIFY_DB_USER (root)               NOTIFY_DB_PASSWORD (required)
//   NOTIFY_DB_NAME (tender_notify)

import mysql from "mysql2/promise";

export type Subscriber = {
  member_uuid: string;
  email: string | null;
  telegram_chat_id: string | null;
  telegram_link_token: string | null;
  digest_mode: number;
  paused_until: Date | null;
};
export type Criteria = { q?: string; cat?: string; region?: string; deadline?: string; closed?: string };
export type Channels = { email?: boolean; telegram?: boolean };
export type Alert = {
  id: number;
  member_uuid: string;
  label: string;
  criteria: Criteria;
  channels: Channels;
  created_at: Date;
};

const DB = process.env.NOTIFY_DB_NAME || "tender_notify";

let pool: mysql.Pool | null = null;

// Bootstrap: create the database + tables if missing, then return a pool bound
// to it. Safe to call on every startup.
export async function initStore(): Promise<mysql.Pool> {
  if (pool) return pool;
  const base = {
    host: process.env.NOTIFY_DB_HOST || "127.0.0.1",
    port: Number(process.env.NOTIFY_DB_PORT || 3306),
    user: process.env.NOTIFY_DB_USER || "root",
    password: process.env.NOTIFY_DB_PASSWORD || "",
    multipleStatements: true,
  };
  const boot = await mysql.createConnection(base);
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await boot.query(`USE \`${DB}\``);
  await boot.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      member_uuid VARCHAR(64) PRIMARY KEY,
      email VARCHAR(255) NULL,
      telegram_chat_id VARCHAR(64) NULL,
      telegram_link_token VARCHAR(64) NULL,
      digest_mode TINYINT NOT NULL DEFAULT 0,
      paused_until DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_link_token (telegram_link_token),
      KEY idx_chat (telegram_chat_id)
    ) ENGINE=InnoDB`);
  await boot.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      member_uuid VARCHAR(64) NOT NULL,
      label VARCHAR(255) NOT NULL,
      criteria_json JSON NOT NULL,
      channels_json JSON NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_member (member_uuid)
    ) ENGINE=InnoDB`);
  await boot.query(`
    CREATE TABLE IF NOT EXISTS sent_log (
      member_uuid VARCHAR(64) NOT NULL,
      tender_id VARCHAR(191) NOT NULL,
      kind VARCHAR(24) NOT NULL,
      channel VARCHAR(24) NOT NULL,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (member_uuid, tender_id, kind, channel),
      KEY idx_sent_at (sent_at)
    ) ENGINE=InnoDB`);
  await boot.query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(64) PRIMARY KEY,
      value TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
  await boot.end();

  pool = mysql.createPool({ ...base, database: DB, connectionLimit: 5, multipleStatements: false });
  return pool;
}

function db(): mysql.Pool {
  if (!pool) throw new Error("store not initialised — call initStore() first");
  return pool;
}

// ── settings (key/value operator config) ─────────────────────────────────────
export async function getSettings(): Promise<Record<string, string>> {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT `key`, value FROM settings");
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
export async function setSetting(key: string, value: string | null): Promise<void> {
  await db().query("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
}

// ── subscribers ──────────────────────────────────────────────────────────────
export async function upsertSubscriber(uuid: string, email: string | null): Promise<void> {
  await db().query(
    "INSERT INTO subscribers (member_uuid, email) VALUES (?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email)",
    [uuid, email],
  );
}
export async function getSubscriber(uuid: string): Promise<Subscriber | null> {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM subscribers WHERE member_uuid = ?", [uuid]);
  return (rows[0] as Subscriber) || null;
}
export async function setLinkToken(uuid: string, token: string): Promise<void> {
  await db().query("UPDATE subscribers SET telegram_link_token = ? WHERE member_uuid = ?", [token, uuid]);
}
export async function bindTelegramByToken(token: string, chatId: string): Promise<Subscriber | null> {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT member_uuid FROM subscribers WHERE telegram_link_token = ?", [token]);
  if (!rows.length) return null;
  const uuid = rows[0].member_uuid as string;
  await db().query("UPDATE subscribers SET telegram_chat_id = ?, telegram_link_token = NULL WHERE member_uuid = ?", [chatId, uuid]);
  return getSubscriber(uuid);
}
export async function unlinkTelegramByChat(chatId: string): Promise<void> {
  await db().query("UPDATE subscribers SET telegram_chat_id = NULL WHERE telegram_chat_id = ?", [chatId]);
}
export async function setPrefs(uuid: string, prefs: { digest_mode?: boolean; paused_until?: Date | null }): Promise<void> {
  if (prefs.digest_mode !== undefined) await db().query("UPDATE subscribers SET digest_mode = ? WHERE member_uuid = ?", [prefs.digest_mode ? 1 : 0, uuid]);
  if (prefs.paused_until !== undefined) await db().query("UPDATE subscribers SET paused_until = ? WHERE member_uuid = ?", [prefs.paused_until, uuid]);
}

// ── alerts ───────────────────────────────────────────────────────────────────
export async function listAlerts(uuid: string): Promise<Alert[]> {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM alerts WHERE member_uuid = ? ORDER BY created_at DESC", [uuid]);
  return rows.map(rowToAlert);
}
export async function allAlerts(): Promise<(Alert & { subscriber: Subscriber })[]> {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT a.*, s.email, s.telegram_chat_id, s.digest_mode, s.paused_until FROM alerts a JOIN subscribers s ON s.member_uuid = a.member_uuid",
  );
  return rows.map((r) => ({
    ...rowToAlert(r),
    subscriber: {
      member_uuid: r.member_uuid, email: r.email, telegram_chat_id: r.telegram_chat_id,
      telegram_link_token: null, digest_mode: r.digest_mode, paused_until: r.paused_until,
    },
  }));
}
export async function createAlert(uuid: string, label: string, criteria: Criteria, channels: Channels): Promise<number> {
  const [res] = await db().query<mysql.ResultSetHeader>(
    "INSERT INTO alerts (member_uuid, label, criteria_json, channels_json) VALUES (?, ?, ?, ?)",
    [uuid, label.slice(0, 255), JSON.stringify(criteria), JSON.stringify(channels)],
  );
  return res.insertId;
}
export async function deleteAlert(uuid: string, id: number): Promise<void> {
  await db().query("DELETE FROM alerts WHERE id = ? AND member_uuid = ?", [id, uuid]);
}
function rowToAlert(r: mysql.RowDataPacket): Alert {
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v || {});
  return { id: r.id, member_uuid: r.member_uuid, label: r.label, criteria: parse(r.criteria_json), channels: parse(r.channels_json), created_at: r.created_at };
}

// ── sent-log (idempotency) ───────────────────────────────────────────────────
// Returns true if this (member, tender, kind, channel) had NOT been sent before
// (and records it). Atomic via the PK — safe against double-sends.
export async function markSent(uuid: string, tenderId: string, kind: string, channel: string): Promise<boolean> {
  try {
    await db().query("INSERT INTO sent_log (member_uuid, tender_id, kind, channel) VALUES (?, ?, ?, ?)", [uuid, tenderId, kind, channel]);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return false;
    throw e;
  }
}
// Release a reservation when a send fails, so the next run retries it.
export async function unmarkSent(uuid: string, tenderId: string, kind: string, channel: string): Promise<void> {
  await db().query("DELETE FROM sent_log WHERE member_uuid = ? AND tender_id = ? AND kind = ? AND channel = ?", [uuid, tenderId, kind, channel]);
}
export async function lastDigestAt(uuid: string): Promise<Date | null> {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT MAX(sent_at) m FROM sent_log WHERE member_uuid = ? AND kind = 'digest'", [uuid]);
  return rows[0]?.m ?? null;
}
export async function sentCountToday(uuid: string): Promise<number> {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT COUNT(*) c FROM sent_log WHERE member_uuid = ? AND sent_at >= CURDATE()", [uuid]);
  return Number(rows[0]?.c || 0);
}

// ── insights (admin page) ────────────────────────────────────────────────────
export async function insights(): Promise<Record<string, unknown>> {
  const q = async (sql: string) => {
    const [rows] = await db().query<mysql.RowDataPacket[]>(sql);
    return rows;
  };
  const [subs, alerts, sends7, sendsToday, topCat, topRegion, recent] = await Promise.all([
    q("SELECT COUNT(*) c, SUM(telegram_chat_id IS NOT NULL) tg FROM subscribers"),
    q("SELECT COUNT(*) c FROM alerts"),
    q("SELECT COUNT(*) c FROM sent_log WHERE sent_at >= NOW() - INTERVAL 7 DAY"),
    q("SELECT COUNT(*) c FROM sent_log WHERE sent_at >= CURDATE()"),
    q("SELECT JSON_UNQUOTE(JSON_EXTRACT(criteria_json,'$.cat')) k, COUNT(*) c FROM alerts WHERE JSON_EXTRACT(criteria_json,'$.cat') IS NOT NULL GROUP BY k ORDER BY c DESC LIMIT 8"),
    q("SELECT JSON_UNQUOTE(JSON_EXTRACT(criteria_json,'$.region')) k, COUNT(*) c FROM alerts WHERE JSON_EXTRACT(criteria_json,'$.region') IS NOT NULL GROUP BY k ORDER BY c DESC LIMIT 8"),
    q("SELECT member_uuid, tender_id, kind, channel, sent_at FROM sent_log ORDER BY sent_at DESC LIMIT 20"),
  ]);
  return {
    subscribers: Number(subs[0]?.c || 0),
    telegramLinked: Number(subs[0]?.tg || 0),
    alerts: Number(alerts[0]?.c || 0),
    sends7d: Number(sends7[0]?.c || 0),
    sendsToday: Number(sendsToday[0]?.c || 0),
    topCategories: topCat.map((r) => ({ key: r.k, count: Number(r.c) })),
    topRegions: topRegion.map((r) => ({ key: r.k, count: Number(r.c) })),
    recent,
  };
}
