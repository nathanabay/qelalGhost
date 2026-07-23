// Render tenders to per-channel messages (email subject/html/text + Telegram HTML).
import type { Msg } from "./senders";

export type Item = { title: string; url: string; deadline: string | null; region?: string | null; publishing_entity?: string | null };

function esc(s: string): string {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function metaLine(it: Item): string {
  const parts: string[] = [];
  if (it.deadline) parts.push(`Deadline ${it.deadline}`);
  if (it.publishing_entity) parts.push(it.publishing_entity);
  if (it.region) parts.push(it.region);
  return parts.join(" · ");
}
const foot = (siteUrl: string) => `Manage your alerts: ${siteUrl}/alerts/`;

// A single new-tender alert.
export function formatNew(it: Item, siteUrl: string): Msg {
  const meta = metaLine(it);
  const subject = `New tender: ${it.title}`.slice(0, 180);
  const telegramHtml =
    `🔔 <b>New tender</b>\n<a href="${esc(it.url)}">${esc(it.title)}</a>` +
    (meta ? `\n${esc(meta)}` : "") +
    `\n\n<a href="${esc(siteUrl)}/alerts/">Manage alerts</a>`;
  const html =
    `<h2>New tender matching your alert</h2>` +
    `<p><a href="${esc(it.url)}">${esc(it.title)}</a></p>` +
    (meta ? `<p style="color:#555">${esc(meta)}</p>` : "") +
    `<p style="color:#888;font-size:12px">${esc(foot(siteUrl))}</p>`;
  const text = `New tender matching your alert:\n${it.title}\n${it.url}\n${meta}\n\n${foot(siteUrl)}`;
  return { subject, html, text, telegramHtml };
}

// A deadline reminder.
export function formatReminder(it: Item, daysLeft: number, siteUrl: string): Msg {
  const when = daysLeft <= 0 ? "closes today" : `closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  const meta = metaLine(it);
  const subject = `⏰ Tender ${when}: ${it.title}`.slice(0, 180);
  const telegramHtml =
    `⏰ <b>Tender ${esc(when)}</b>\n<a href="${esc(it.url)}">${esc(it.title)}</a>` +
    (meta ? `\n${esc(meta)}` : "") +
    `\n\n<a href="${esc(siteUrl)}/alerts/">Manage alerts</a>`;
  const html =
    `<h2>A tender you follow ${esc(when)}</h2>` +
    `<p><a href="${esc(it.url)}">${esc(it.title)}</a></p>` +
    (meta ? `<p style="color:#555">${esc(meta)}</p>` : "") +
    `<p style="color:#888;font-size:12px">${esc(foot(siteUrl))}</p>`;
  const text = `A tender you follow ${when}:\n${it.title}\n${it.url}\n${meta}\n\n${foot(siteUrl)}`;
  return { subject, html, text, telegramHtml };
}

// A digest of several new tenders.
export function formatDigest(items: Item[], siteUrl: string): Msg {
  const n = items.length;
  const subject = `${n} new tender${n === 1 ? "" : "s"} matching your alerts`;
  const li = (it: Item) => {
    const meta = metaLine(it);
    return { tg: `• <a href="${esc(it.url)}">${esc(it.title)}</a>${meta ? `\n  ${esc(meta)}` : ""}`,
      html: `<li><a href="${esc(it.url)}">${esc(it.title)}</a>${meta ? `<br><span style="color:#555">${esc(meta)}</span>` : ""}</li>`,
      text: `• ${it.title}\n  ${it.url}\n  ${meta}` };
  };
  const parts = items.map(li);
  const telegramHtml = `📬 <b>${n} new tender${n === 1 ? "" : "s"} for you</b>\n\n` + parts.map((p) => p.tg).join("\n\n") + `\n\n<a href="${esc(siteUrl)}/alerts/">Manage alerts</a>`;
  const html = `<h2>${n} new tender${n === 1 ? "" : "s"} matching your alerts</h2><ul>` + parts.map((p) => p.html).join("") + `</ul><p style="color:#888;font-size:12px">${esc(foot(siteUrl))}</p>`;
  const text = `${n} new tenders matching your alerts:\n\n` + parts.map((p) => p.text).join("\n\n") + `\n\n${foot(siteUrl)}`;
  return { subject, html, text, telegramHtml };
}
