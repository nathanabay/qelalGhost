// Seed every 2merkato category as a Ghost tag, so the full sector taxonomy
// exists even for categories that currently have zero tenders. The Supabase
// `categories` table is the authoritative list (name + slug + position).
// Idempotent: only missing slugs are created.
//
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GHOST_ADMIN_API_URL, GHOST_ADMIN_API_KEY

// @ts-ignore - runtime WebSocket polyfill for Node < 22 (Supabase realtime)
import { WebSocket as NodeWebSocket } from "ws";
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = NodeWebSocket;
}

import { createClient } from "@supabase/supabase-js";
import { GhostAdminClient } from "./lib/ghost";

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const g = new GhostAdminClient();

  const { data: cats, error } = await sb
    .from("categories")
    .select("name,slug,position")
    .order("position");
  if (error) throw new Error(error.message);
  console.log(`Supabase categories: ${cats!.length}`);

  const existing = new Set<string>();
  let page = 1;
  for (;;) {
    const b = await g.adminGet<{ tags: { slug: string }[]; meta: { pagination: { pages: number } } }>(
      `/tags/?limit=100&page=${page}&fields=slug`,
    );
    b.tags.forEach((t) => existing.add(t.slug));
    if (page >= b.meta.pagination.pages) break;
    page += 1;
  }
  console.log(`Existing Ghost tags: ${existing.size}`);

  const missing = cats!.filter((c) => !existing.has(c.slug));
  console.log(`Creating ${missing.length} missing category tags…`);

  let ok = 0;
  for (const c of missing) {
    try {
      await g.adminPost("/tags/", { tags: [{ name: c.name, slug: c.slug }] });
      ok += 1;
    } catch (err) {
      console.error(`  ✗ ${c.slug}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  console.log(`Done. created=${ok}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
