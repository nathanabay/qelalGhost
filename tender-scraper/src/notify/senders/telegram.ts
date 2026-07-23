// Telegram Bot API sender + admin helpers (getMe / setWebhook).
import type { Config } from "../config";

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };

export async function sendTelegram(cfg: Config, chatId: string, html: string, keyboard?: InlineKeyboard): Promise<void> {
  const r = await fetch(api(cfg.telegram.token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...(keyboard ? { reply_markup: keyboard } : {}) }),
  });
  if (!r.ok) throw new Error(`telegram sendMessage ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

// Edit an existing message in place (for inline-keyboard navigation).
export async function editTelegram(cfg: Config, chatId: string, messageId: number, html: string, keyboard?: InlineKeyboard): Promise<void> {
  const r = await fetch(api(cfg.telegram.token, "editMessageText"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...(keyboard ? { reply_markup: keyboard } : {}) }),
  });
  if (!r.ok) throw new Error(`editMessageText ${r.status}`);
}

// Answer a callback query (stops the loading spinner; optional toast).
export async function answerCallback(cfg: Config, id: string, text?: string): Promise<void> {
  await fetch(api(cfg.telegram.token, "answerCallbackQuery"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, ...(text ? { text } : {}) }),
  }).catch(() => {});
}

// Publish the slash-command menu (shown in the Telegram "/" picker).
export async function setBotCommands(cfg: Config, commands: { command: string; description: string }[]): Promise<void> {
  await fetch(api(cfg.telegram.token, "setMyCommands"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  }).catch(() => {});
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
      body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message", "edited_message", "callback_query", "inline_query"] }),
    });
    const b = (await r.json()) as { ok: boolean; description?: string };
    return b.ok ? { ok: true } : { ok: false, error: b.description };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}
