// Enrichment backfill: for every existing 2merkato tender, re-read its detail
// page and REGENERATE the "Tender details" facts block with the newly-captured
// fields — bid opening date/time, bid closing time, buyer TIN/phone/website/
// address, and attached documents — while preserving the original description.
// Also ensures the region-* tag is present. Idempotent (facts are regenerated,
// not appended) and resumable. Gentle 2merkato pacing (450ms) avoids 429s.
//
//   GHOST_ADMIN_API_URL, GHOST_ADMIN_API_KEY, MERKATO_USERNAME, MERKATO_PASSWORD
//   MAX_POSTS=N for a small test run.

import { GhostAdminClient, regionSlug, tenderFactsHtml } from "./lib/ghost";
import { detailFactsInput } from "./sources/2merkato";
import { merkatoLogin, merkatoGetDataPage } from "./lib/merkato-auth";
import type { TenderInput } from "./lib/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The description is everything before the facts block. Cut at the "Tender
// details" heading (and drop the <hr> right before it), so regenerating never
// duplicates facts and never touches the description.
function splitDescription(html: string): string {
  const idx = html.search(/<h[1-6][^>]*>\s*Tender details\s*<\/h[1-6]>/i);
  if (idx < 0) return html.trim();
  const before = html.slice(0, idx);
  const hr = before.match(/<hr\s*\/?>\s*$/i);
  return (hr ? before.slice(0, before.length - hr[0].length) : before).trim();
}

type Post = {
  id: string;
  canonical_url: string | null;
  updated_at: string;
  html: string | null;
  tags?: { name: string; slug: string }[];
};

async function main() {
  const g = new GhostAdminClient();
  const s = await merkatoLogin(
    process.env.MERKATO_USERNAME as string,
    process.env.MERKATO_PASSWORD as string,
  );
  console.log("2merkato: authenticated.");

  const MAX = Number(process.env.MAX_POSTS || 0);
  let page = 1;
  let scanned = 0, enriched = 0, noDetail = 0, failed = 0;

  outer: for (;;) {
    const body = await g.adminGet<{ posts: Post[]; meta: { pagination: { pages: number } } }>(
      `/posts/?filter=${encodeURIComponent("slug:~'tender-'")}&limit=25&page=${page}` +
        `&order=${encodeURIComponent("published_at asc")}&include=tags&formats=html&fields=id,canonical_url,updated_at,html`,
    );
    for (const p of body.posts) {
      scanned++;
      const url = p.canonical_url || "";
      if (!url.includes("tender.2merkato.com")) continue;
      const id = url.split("/").filter(Boolean).pop();

      await sleep(450);
      let raw: { region?: unknown } | null = null;
      try {
        const dp = (await merkatoGetDataPage(s, `https://tender.2merkato.com/tenders/${id}`)) as {
          props?: { tender?: unknown };
        } | null;
        raw = (dp?.props?.tender as { region?: unknown }) ?? null;
      } catch {
        failed++;
        continue;
      }
      if (!raw) { noDetail++; continue; }

      const input = detailFactsInput(raw as never) as TenderInput;
      const description = splitDescription(p.html || "");
      const newHtml = [description, tenderFactsHtml(input)].filter(Boolean).join("\n");

      const tags = (p.tags || []).map((t) => ({ name: t.name, slug: t.slug }));
      if (input.region && !tags.some((t) => (t.slug || "").startsWith("region-"))) {
        tags.push({ name: input.region, slug: regionSlug(input.region) });
      }
      // Sync the featured/proforma flag tags to 2merkato's current state.
      const setFlag = (slug: string, name: string, on: boolean) => {
        const i = tags.findIndex((t) => t.slug === slug);
        if (on && i < 0) tags.push({ name, slug });
        if (!on && i >= 0) tags.splice(i, 1);
      };
      setFlag("featured", "Featured", Boolean(input.featured));
      setFlag("proforma", "Proforma", Boolean(input.proforma));

      try {
        await g.adminPut(`/posts/${p.id}/?source=html`, {
          posts: [{ updated_at: p.updated_at, html: newHtml, tags }],
        });
        enriched++;
      } catch (e) {
        failed++;
        console.error(`  ✗ ${p.id}: ${(e as Error).message.slice(0, 140)}`);
      }
      if ((enriched + failed + noDetail) % 50 === 0)
        console.log(`… scanned ${scanned} · enriched ${enriched} · no-detail ${noDetail} · failed ${failed}`);
      if (MAX && enriched >= MAX) break outer;
    }
    if (page >= (body.meta?.pagination?.pages ?? page)) break;
    page += 1;
  }
  console.log(`\nDone. scanned=${scanned} enriched=${enriched} no-detail=${noDetail} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
