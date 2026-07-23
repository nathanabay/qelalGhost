// Telegram Bot API sender + admin helpers (getMe / setWebhook).
import type { Config } from "../config";

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export type InlineButton = { text: string; callback_data?: string; url?: string; web_app?: { url: string }; switch_inline_query_current_chat?: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

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

// Set the persistent blue "menu button" next to the input box to launch the
// Mini App (WebApp). Applies to every private chat that hasn't overridden it.
export async function setChatMenuButton(cfg: Config, text: string, url: string): Promise<void> {
  await fetch(api(cfg.telegram.token, "setChatMenuButton"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu_button: { type: "web_app", text, web_app: { url } } }),
  }).catch(() => {});
}

// Inline-mode result article (@bot <query> in any chat).
export type InlineResult = {
  type: "article";
  id: string;
  title: string;
  description?: string;
  input_message_content: { message_text: string; parse_mode?: string; disable_web_page_preview?: boolean };
  reply_markup?: InlineKeyboard;
};
export async function answerInlineQuery(
  cfg: Config,
  inlineQueryId: string,
  results: InlineResult[],
  opts: { cache_time?: number; is_personal?: boolean } = {},
): Promise<void> {
  await fetch(api(cfg.telegram.token, "answerInlineQuery"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inline_query_id: inlineQueryId, results, cache_time: opts.cache_time ?? 30, is_personal: opts.is_personal ?? false }),
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
