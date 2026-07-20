import { load } from "cheerio";

// 2merkato is an Inertia.js (Laravel + Vue) app. Authenticating unlocks the
// bid_closing_date that non-subscribers see as "Subscription required".
// Credentials come from env only (MERKATO_USERNAME / MERKATO_PASSWORD) — never
// hardcoded. Ports the login handshake from the existing Scrapy spider.
const BASE = "https://tender.2merkato.com";
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type Jar = Map<string, string>;
export type MerkatoSession = { jar: Jar; version: string | null };

function mergeCookies(jar: Jar, setCookies: string[]): void {
  for (const sc of setCookies) {
    const pair = sc.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

export function cookieHeaderFor(session: MerkatoSession): string {
  return [...session.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function parseDataPage(html: string): {
  props?: { csrf_token?: string; auth?: { user?: unknown } };
  version?: string;
} | null {
  const raw = load(html)("#app").attr("data-page");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Perform the Inertia login handshake and return a cookie jar for authed GETs.
export async function merkatoLogin(
  username: string,
  password: string,
): Promise<MerkatoSession> {
  const jar: Jar = new Map();

  // 1) GET /login → session + XSRF cookies, plus csrf_token & inertia version.
  const r1 = await fetch(`${BASE}/login`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  mergeCookies(jar, r1.headers.getSetCookie());
  const page = parseDataPage(await r1.text());
  const csrf = page?.props?.csrf_token ?? null;
  const version = page?.version ?? null;
  const xsrfCookie = jar.get("XSRF-TOKEN");
  const xsrf = xsrfCookie ? decodeURIComponent(xsrfCookie) : null;

  // 2) POST credentials via Inertia. Laravel accepts either the csrf_token
  //    (X-CSRF-TOKEN) or the XSRF cookie (X-XSRF-TOKEN) — send both.
  const r2 = await fetch(`${BASE}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Inertia": "true",
      ...(version ? { "X-Inertia-Version": version } : {}),
      ...(csrf ? { "X-CSRF-TOKEN": csrf } : {}),
      ...(xsrf ? { "X-XSRF-TOKEN": xsrf } : {}),
      Origin: BASE,
      Referer: `${BASE}/login`,
      Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: JSON.stringify({
      emailOrMobile: username,
      password,
      remember: true,
    }),
  });
  mergeCookies(jar, r2.headers.getSetCookie());

  if (r2.status === 422) {
    throw new Error(
      "2merkato login rejected (422) — check MERKATO_USERNAME / MERKATO_PASSWORD",
    );
  }
  return { jar, version };
}

// Fetch a page with the session cookies and return its parsed data-page JSON.
export async function merkatoGetDataPage(
  session: MerkatoSession,
  url: string,
): Promise<{ props?: { auth?: { user?: unknown } } } | null> {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html",
      Cookie: cookieHeaderFor(session),
    },
  });
  mergeCookies(session.jar, r.headers.getSetCookie());
  return parseDataPage(await r.text());
}
