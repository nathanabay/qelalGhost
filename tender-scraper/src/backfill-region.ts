// One-time backfill: attach a clean "region-*" tag to every existing 2merkato
// tender by reading its region from the tender's 2merkato detail page (the list
// JSON omits region; it lives only on the detail page).
//
// Idempotent + resumable: posts that already carry a region-* tag are skipped,
// so it can be re-run after an interruption. Gentle 2merkato pacing (450ms)
// avoids 429s. Set MAX_POSTS=N for a small test run.
//
//   GHOST_ADMIN_API_URL, GHOST_ADMIN_API_KEY, MERKATO_USERNAME, MERKATO_PASSWORD

import { GhostAdminClient, regionSlug } from "./lib/ghost";
import { merkatoLogin, merkatoGetDataPage } from "./lib/merkato-auth";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nameOf(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.trim() || null;
  const o = v as { name_en?: string | null; name?: string | null };
  return (o.name_en ?? o.name ?? null) || null;
}

type Post = { id: string; canonical_url: string | null; updated_at: string; tags?: { name: string; slug: string }[] };

async function main() {
  const g = new GhostAdminClient();
  const s = await merkatoLogin(
    process.env.MERKATO_USERNAME as string,
    process.env.MERKATO_PASSWORD as string,
  );
  console.log("2merkato: authenticated.");

  const MAX = Number(process.env.MAX_POSTS || 0); // 0 = all
  let page = 1;
  let scanned = 0, updated = 0, skipped = 0, noRegion = 0, failed = 0;

  outer: for (;;) {
    // Stable order (published_at asc) so adding tags never shifts pagination.
    const body = await g.adminGet<{ posts: Post[]; meta: { pagination: { pages: number } } }>(
      `/posts/?filter=${encodeURIComponent("slug:~'tender-'")}&limit=50&page=${page}` +
        `&order=${encodeURIComponent("published_at asc")}&include=tags&fields=id,slug,canonical_url,updated_at`,
    );
    for (const p of body.posts) {
      scanned++;
      const url = p.canonical_url || "";
      if (!url.includes("tender.2merkato.com")) { skipped++; continue; }
      if ((p.tags || []).some((t) => (t.slug || "").startsWith("region-"))) { skipped++; continue; }

      const id = url.split("/").filter(Boolean).pop();
      await sleep(450);
      let region: string | null = null;
      try {
        const dp = (await merkatoGetDataPage(s, `https://tender.2merkato.com/tenders/${id}`)) as {
          props?: { tender?: { region?: unknown } };
        } | null;
        region = nameOf(dp?.props?.tender?.region);
      } catch {
        failed++;
        continue;
      }
      if (!region) { noRegion++; continue; }

      const tags = (p.tags || []).map((t) => ({ name: t.name, slug: t.slug }));
      tags.push({ name: region, slug: regionSlug(region) });
      try {
        await g.adminPut(`/posts/${p.id}/`, { posts: [{ updated_at: p.updated_at, tags }] });
        updated++;
      } catch (e) {
        failed++;
        console.error(`  ✗ ${p.id}: ${(e as Error).message.slice(0, 120)}`);
      }
      if ((updated + noRegion + failed) % 50 === 0)
        console.log(`… scanned ${scanned} · tagged ${updated} · no-region ${noRegion} · failed ${failed}`);
      if (MAX && updated >= MAX) break outer;
    }
    if (page >= (body.meta?.pagination?.pages ?? page)) break;
    page += 1;
  }
  console.log(`\nDone. scanned=${scanned} tagged=${updated} skipped=${skipped} no-region=${noRegion} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
