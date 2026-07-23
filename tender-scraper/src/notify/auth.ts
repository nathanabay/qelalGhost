// Cookie auth against Ghost — no separate login.
//  • memberFromCookie: validates the `ghost-members-ssr` cookie via Ghost's
//    Members API, so only signed-in members can create/list their alerts.
//  • staffFromCookie: validates the `ghost-admin-api-session` cookie via the
//    Admin API, gating the operator settings page (same idea as admin/server.mjs).

import type { IncomingMessage } from "node:http";

type CacheEntry<T> = { val: T | null; exp: number };
const memberCache = new Map<string, CacheEntry<{ uuid: string; email: string; name: string | null }>>();
const staffCache = new Map<string, CacheEntry<{ id: string; email: string; name: string }>>();

function cookie(req: IncomingMessage): string {
  return req.headers.cookie || "";
}

export async function memberFromCookie(
  req: IncomingMessage,
  ghostUrl: string,
): Promise<{ uuid: string; email: string; name: string | null } | null> {
  const c = cookie(req);
  if (!/ghost-members-ssr=/.test(c)) return null;
  const hit = memberCache.get(c);
  if (hit && hit.exp > Date.now()) return hit.val;
  let val: { uuid: string; email: string; name: string | null } | null = null;
  try {
    const r = await fetch(`${ghostUrl}/members/api/member/`, { headers: { Cookie: c } });
    if (r.ok) {
      const m = (await r.json()) as { uuid?: string; email?: string; name?: string } | null;
      if (m && m.uuid && m.email) val = { uuid: m.uuid, email: m.email, name: m.name ?? null };
    }
  } catch {
    /* treat as signed-out */
  }
  memberCache.set(c, { val, exp: Date.now() + (val ? 60000 : 10000) });
  return val;
}

export async function staffFromCookie(
  req: IncomingMessage,
  ghostAdminUrl: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const c = cookie(req);
  if (!/ghost-admin-api-session=/.test(c)) return null;
  const hit = staffCache.get(c);
  if (hit && hit.exp > Date.now()) return hit.val;
  let val: { id: string; email: string; name: string } | null = null;
  try {
    const r = await fetch(`${ghostAdminUrl}/ghost/api/admin/users/me/?fields=id,name,email`, {
      headers: { Cookie: c, "Accept-Version": "v5.0" },
    });
    if (r.ok) {
      const b = (await r.json()) as { users?: { id: string; email: string; name: string }[] };
      val = (b.users && b.users[0]) || null;
    }
  } catch {
    /* unauthenticated */
  }
  staffCache.set(c, { val, exp: Date.now() + (val ? 60000 : 10000) });
  return val;
}
