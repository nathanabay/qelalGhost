// Index Ghost tender posts into a Meilisearch index the Ghost site owns.
//
// Unlike Qellal's `tenders` index (keyed by Supabase UUID, pointing at the
// Next.js app), this builds an isolated `ghost_tenders` index whose docs carry
// the Ghost post URL — so the theme's search links straight to Ghost pages.
//
//   MEILI_HOST                              — required
//   MEILI_MASTER_KEY                        — required (create index/key/settings)
//   GHOST_ADMIN_API_URL, GHOST_ADMIN_API_KEY — required (read posts)
//   MEILI_INDEX  (default "ghost_tenders")
//
// Emits a search-only key for the index to .ghost-meili-search-key.

import { writeFileSync } from "node:fs";
import { GhostAdminClient } from "./lib/ghost";
import { meiliSynonyms } from "./lib/synonyms";

const HOST = (process.env.MEILI_HOST || "").replace(/\/+$/, "");
const MASTER = process.env.MEILI_MASTER_KEY || "";
const INDEX = process.env.MEILI_INDEX || "ghost_tenders";

if (!HOST || !MASTER) throw new Error("MEILI_HOST and MEILI_MASTER_KEY are required");

async function meili<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  // Retry transient network errors (e.g. a brief VPS connect timeout) with
  // backoff, so a single blip doesn't abort the whole re-index. HTTP errors
  // (4xx/5xx from Meili) are not retried — those are real and should surface.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(`${HOST}${path}`, {
        method,
        headers: { Authorization: `Bearer ${MASTER}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok && r.status !== 202) throw new Error(`Meili ${method} ${path} → ${r.status}: ${await r.text()}`);
      return (await r.json()) as T;
    } catch (err) {
      // Meili HTTP errors (message starts with "Meili ") are terminal.
      if (err instanceof Error && err.message.startsWith("Meili ")) throw err;
      lastErr = err;
      if (attempt < 4) {
        const wait = 1000 * attempt;
        console.warn(`  network error on ${method} ${path} (attempt ${attempt}/4) — retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function waitForTask(uid: number): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const t = await meili<{ status: string; error?: { message: string } }>("GET", `/tasks/${uid}`);
    if (t.status === "succeeded") return;
    if (t.status === "failed" || t.status === "canceled") {
      throw new Error(`Meili task ${uid} ${t.status}: ${t.error?.message ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// A search-only key scoped to the index; created once, then reused.
async function ensureSearchKey(): Promise<string> {
  const list = await meili<{ results: { name: string; key: string; indexes: string[] }[] }>("GET", "/keys?limit=100");
  const existing = list.results.find((k) => k.name === `ghost-tenders-search`);
  if (existing) return existing.key;
  const created = await meili<{ key: string }>("POST", "/keys", {
    name: "ghost-tenders-search",
    description: "Search-only key for the Ghost site (ghost_tenders index).",
    actions: ["search"],
    indexes: [INDEX],
    expiresAt: null,
  });
  return created.key;
}

type Tag = { name: string; slug: string };
type Post = {
  title: string;
  slug: string;
  url: string;
  custom_excerpt: string | null;
  plaintext: string | null;
  published_at: string | null;
  tags: Tag[];
};

const NON_CATEGORY = new Set(["english", "amharic", "2merkato"]);

function deadlineOf(excerpt: string | null): { deadline: string | null; ts: number } {
  const m = (excerpt || "").match(/Deadline\s+(\d{4}-\d{2}-\d{2})/i);
  if (!m) return { deadline: null, ts: 0 };
  const ms = Date.parse(m[1]);
  return { deadline: m[1], ts: Number.isNaN(ms) ? 0 : Math.floor(ms / 1000) };
}

function toDoc(p: Post, todayStart: number) {
  const entity = p.tags.find((t) => t.slug.startsWith("entity-"));
  const categories = p.tags
    .filter((t) => !t.slug.startsWith("entity-") && !NON_CATEGORY.has(t.slug))
    .map((t) => t.name);
  const { deadline, ts: deadline_ts } = deadlineOf(p.custom_excerpt);
  const pubMs = p.published_at ? Date.parse(p.published_at) : NaN;
  const published_ts = Number.isNaN(pubMs) ? 0 : Math.floor(pubMs / 1000);
  return {
    id: p.slug,
    url: p.url,
    title: p.title,
    publishing_entity: entity ? entity.name : null,
    categories,
    // Index the full description so every word is searchable (generous cap
    // keeps the index sane for the rare multi-page notice).
    description: (p.plaintext || "").replace(/\s+/g, " ").trim().slice(0, 20000),
    deadline,
    deadline_ts,
    published_ts,
    open_rank: deadline_ts >= todayStart ? 0 : 1,
  };
}

async function main() {
  const ghost = new GhostAdminClient();

  console.log(`Creating index "${INDEX}"…`);
  const created = await meili<{ taskUid: number }>("POST", "/indexes", { uid: INDEX, primaryKey: "id" });
  if (created.taskUid != null) await waitForTask(created.taskUid).catch(() => {});

  console.log("Applying settings + synonyms…");
  const settings = await meili<{ taskUid: number }>("PATCH", `/indexes/${INDEX}/settings`, {
    // "*" = every attribute is searchable (title, description, publishing
    // entity, categories/region/source). Order-based ranking still favours the
    // title because it's the first field on each document.
    searchableAttributes: ["*"],
    filterableAttributes: ["deadline_ts", "open_rank", "categories", "publishing_entity"],
    sortableAttributes: ["published_ts", "deadline_ts", "open_rank"],
    synonyms: meiliSynonyms(),
  });
  await waitForTask(settings.taskUid);

  console.log("Reading Ghost tenders…");
  const todayStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);
  const filter = encodeURIComponent("tag:2merkato");
  let page = 1;
  let total = 0;
  let lastTask = 0;
  for (;;) {
    const body = await ghost.adminGet<{ posts: Post[]; meta: { pagination: { pages: number } } }>(
      `/posts/?filter=${filter}&limit=100&page=${page}&include=tags&formats=plaintext&fields=title,slug,url,custom_excerpt,published_at,plaintext`,
    );
    const docs = body.posts.map((p) => toDoc(p, todayStart));
    if (docs.length) {
      const res = await meili<{ taskUid: number }>("POST", `/indexes/${INDEX}/documents?primaryKey=id`, docs);
      lastTask = res.taskUid;
      total += docs.length;
      console.log(`  …pushed ${total}`);
    }
    if (page >= (body.meta?.pagination?.pages ?? page)) break;
    page += 1;
  }
  if (lastTask) await waitForTask(lastTask);

  const key = await ensureSearchKey();
  writeFileSync(new URL("../.ghost-meili-search-key", import.meta.url), key);
  const stats = await meili<{ numberOfDocuments: number }>("GET", `/indexes/${INDEX}/stats`);
  console.log(`\nDone. Indexed ${total} tenders (index reports ${stats.numberOfDocuments} docs).`);
  console.log(`Search key (scoped to "${INDEX}") written to .ghost-meili-search-key:`);
  console.log(`  ${key}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
