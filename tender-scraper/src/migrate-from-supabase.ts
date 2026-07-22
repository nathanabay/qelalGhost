// One-off migration: Supabase `tenders` → Ghost posts, Ghost-native.
//
// Unlike the Qellal in-repo migration, this maps each Supabase row to the
// scraper's TenderInput and reuses tenderToPost, so every post gets the full tag
// set in ONE pass: categories + region + language + source + entity (buyer).
// Idempotent — stable `tender-<noticeId>` slugs, existing ones skipped.
//
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY       — read source
//   GHOST_ADMIN_API_URL, GHOST_ADMIN_API_KEY      — write target
//   LIMIT=25   STATUS=published   CONCURRENCY=5    — optional

// @supabase/supabase-js constructs a realtime client that needs a global
// WebSocket; Node < 22 (the VPS runs 20) doesn't have one. We only use REST, so
// polyfill it with `ws` before creating the client.
// @ts-ignore - no @types/ws needed for a runtime polyfill
import { WebSocket as NodeWebSocket } from "ws";
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = NodeWebSocket;
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GhostAdminClient, tenderToPost, tenderSlug } from "./lib/ghost";
import type { TenderInput } from "./lib/types";

const PAGE = 1000;

type Row = {
  id: string;
  title: string;
  description: string | null;
  category_id: number | null;
  region: string | null;
  publishing_entity: string | null;
  published_date: string | null;
  deadline: string;
  source_name: string | null;
  source_url: string | null;
  bid_bond: string | null;
  bid_document_price: string | null;
  published_on: string | null;
  posted_at: string | null;
  status: string | null;
};

async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function mapWithConcurrency<T>(items: T[], n: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) return;
        await worker(items[idx]);
      }
    }),
  );
}

function toInput(r: Row, cat: Map<number, { name: string; slug: string }>, tc: Map<string, number[]>): TenderInput {
  const ids: number[] = [];
  if (r.category_id != null) ids.push(r.category_id);
  for (const id of tc.get(r.id) ?? []) if (!ids.includes(id)) ids.push(id);
  const categories = ids.map((id) => cat.get(id)).filter((c): c is { name: string; slug: string } => !!c);
  return {
    title: r.title,
    description: r.description,
    region: r.region,
    publishing_entity: r.publishing_entity,
    published_date: r.published_date,
    deadline: r.deadline,
    source_name: r.source_name ?? "2merkato",
    source_url: r.source_url ?? `tender-${r.id}`,
    bid_bond: r.bid_bond,
    bid_document_price: r.bid_document_price,
    published_on: r.published_on,
    posted_at: r.posted_at,
    categories,
  };
}

async function main() {
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : null;
  const status = process.env.STATUS || null;
  const concurrency = Number(process.env.CONCURRENCY ?? 5) || 5;

  const sb: SupabaseClient = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const ghost = new GhostAdminClient();

  console.log("Loading categories + join…");
  const [cats, tcRows] = await Promise.all([
    fetchAll<{ id: number; name: string; slug: string }>((f, t) => sb.from("categories").select("id,name,slug").range(f, t)),
    fetchAll<{ tender_id: string; category_id: number }>((f, t) => sb.from("tender_categories").select("tender_id,category_id").range(f, t)),
  ]);
  const catById = new Map(cats.map((c) => [c.id, { name: c.name, slug: c.slug }]));
  const tcByTender = new Map<string, number[]>();
  for (const r of tcRows) {
    const a = tcByTender.get(r.tender_id) ?? [];
    a.push(r.category_id);
    tcByTender.set(r.tender_id, a);
  }
  console.log(`  ${catById.size} categories, ${tcByTender.size} tenders w/ categories`);

  console.log(`Loading tenders (limit=${limit ?? "all"}, status=${status ?? "all"})…`);
  const select = () => {
    let q = sb.from("tenders").select("*").order("published_at", { ascending: false, nullsFirst: false });
    if (status) q = q.eq("status", status);
    return q;
  };
  const tenders: Row[] = limit != null
    ? (((await select().limit(limit)).data ?? []) as Row[])
    : await fetchAll<Row>((f, t) => select().range(f, t) as never);
  console.log(`  ${tenders.length} tenders`);

  const existing = await ghost.getExistingTenderSlugs();
  const authorId = await ghost.getDefaultAuthorId();
  console.log(`  ${existing.size} already on Ghost; author=${authorId ?? "(default)"}`);

  const todo = tenders.filter((r) => {
    const input = toInput(r, catById, tcByTender);
    return input.deadline && !existing.has(tenderSlug(input));
  });
  console.log(`Creating ${todo.length} posts…`);

  let ok = 0;
  let failed = 0;
  const fails: string[] = [];
  await mapWithConcurrency(todo, concurrency, async (r) => {
    const input = toInput(r, catById, tcByTender);
    const slug = tenderSlug(input);
    if (existing.has(slug)) return;
    try {
      await ghost.createPost(tenderToPost(input, authorId));
      existing.add(slug);
      ok += 1;
      if (ok % 100 === 0) console.log(`  …${ok} created`);
    } catch (err) {
      const msg = (err as Error).message;
      if (/already exists|duplicate|slug/i.test(msg)) { existing.add(slug); return; }
      failed += 1;
      if (fails.length < 10) fails.push(`${(r.title || "").slice(0, 50)} :: ${msg.slice(0, 150)}`);
    }
  });

  console.log(`\nDone. created=${ok} failed=${failed}`);
  fails.forEach((f) => console.log("  ✗ " + f));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
