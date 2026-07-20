// CLI: scrape a source and publish new tenders as Ghost posts.
//
// Usage: npm run scrape -- <source> [pages]
//   DRY_RUN=1     → extract + print, publish nothing (no Ghost creds needed)
//   START_PAGE=N  → resume a deep backfill from list page N (default 1)
//
// Requires GHOST_ADMIN_API_URL and GHOST_ADMIN_API_KEY unless DRY_RUN=1.

import { scrape2merkato } from "./sources/2merkato";
import { GhostAdminClient, saveTendersToGhost, tenderSlug } from "./lib/ghost";
import type { TenderInput } from "./lib/types";

type Scraper = (
  pages: number,
  existing: Set<string>,
  onBatch: (rows: TenderInput[]) => Promise<number>,
  startPage: number,
) => Promise<number>;

const SOURCES: Record<string, Scraper> = {
  "2merkato": scrape2merkato,
};

async function main() {
  const which = process.argv[2] ?? "2merkato";
  const pages = Number(process.argv[3] ?? process.env.SCRAPE_PAGES ?? 500) || 500;
  const startPage = Number(process.env.START_PAGE ?? 1) || 1;
  const dry = process.env.DRY_RUN === "1";

  const fn = SOURCES[which];
  if (!fn) {
    console.error(`unknown source "${which}". options: ${Object.keys(SOURCES).join(", ")}`);
    process.exit(1);
  }

  // Ghost client + dedupe state (skip crawl of already-published notices, and
  // a slug set for save-time idempotency). Not needed for a dry run.
  let ghost: GhostAdminClient | null = null;
  let authorId: string | undefined;
  let existing = new Set<string>(); // keyed by source_url (= canonical_url in Ghost)
  const seenSlugs = new Set<string>();
  if (!dry) {
    ghost = new GhostAdminClient();
    authorId = await ghost.getDefaultAuthorId();
    existing = await ghost.getExistingCanonicalUrls();
    // Derive the save-time slug set from the same URLs — no extra API round-trip.
    for (const url of existing) seenSlugs.add(tenderSlug({ source_url: url }));
    console.log(`[ghost] ${existing.size} tenders already published; author=${authorId ?? "(default)"}`);
  }

  let running = 0;
  let previewed = 0;
  const onBatch = async (rows: TenderInput[]): Promise<number> => {
    if (dry || !ghost) {
      if (previewed < 5) {
        console.log(JSON.stringify(rows.slice(0, 5 - previewed), null, 2));
        previewed += rows.length;
      }
      // Keep the dry-run skip-set honest so we don't re-preview duplicates.
      for (const t of rows) existing.add(t.source_url);
      return 0;
    }
    const { inserted, skipped } = await saveTendersToGhost(rows, ghost, seenSlugs, authorId);
    running += inserted;
    console.log(`  …published +${inserted} (skipped ${skipped}, running total ${running})`);
    return inserted;
  };

  console.log(`Scraping ${which} (pages=${pages}, startPage=${startPage}, dry=${dry}) → Ghost…`);
  const total = await fn(pages, existing, onBatch, startPage);

  console.log(
    dry
      ? `DRY_RUN: nothing published. ~${total} candidates.`
      : `Done: ${running} new tenders published as posts.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
