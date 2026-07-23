// Telegram Bot API sender + admin helpers (getMe / setWebhook).
import type { Config } from "../config";

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function sendTelegram(cfg: Config, chatId: string, html: string): Promise<void> {
  const r = await fetch(api(cfg.telegram.token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`telegram sendMessage ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

export async function telegramGetMe(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const r = await fetch(api(token, "getMe"));
    const b = (await r.json()) as { ok: boolean; result?: { username: string }; description?: string };
    return b.ok ? { ok: true, username: b.result?.username } : { ok: false, error: b.description };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

export async function telegramSetWebhook(token: string, url: string, secretToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(api(token, "setWebhook"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message"] }),
    });
    const b = (await r.json()) as { ok: boolean; description?: string };
    return b.ok ? { ok: true } : { ok: false, error: b.description };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}
