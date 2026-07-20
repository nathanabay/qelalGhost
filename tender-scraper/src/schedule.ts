// Long-running background job: scrape → Ghost on a fixed interval.
//
// This is the "runs alongside Ghost" companion to the GitHub Actions schedule.
// Deploy it next to Ghost as a service (systemd / launchd / pm2 / a Docker
// sidecar) and it will re-scrape every SCRAPE_INTERVAL_MINUTES, publishing only
// newly-seen tenders (dedupe is idempotent).
//
//   GHOST_ADMIN_API_URL, GHOST_ADMIN_API_KEY   — required
//   SCRAPE_INTERVAL_MINUTES                     — default 360 (6h)
//   SCRAPE_PAGES                                — default 500
//   MERKATO_USERNAME / MERKATO_PASSWORD         — optional (unlocks deadlines)

import { scrape2merkato } from "./sources/2merkato";
import { GhostAdminClient, saveTendersToGhost, tenderSlug } from "./lib/ghost";
import type { TenderInput } from "./lib/types";

const INTERVAL_MS = (Number(process.env.SCRAPE_INTERVAL_MINUTES) || 360) * 60_000;
const PAGES = Number(process.env.SCRAPE_PAGES) || 500;

async function runOnce(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] scrape run starting…`);

  const ghost = new GhostAdminClient();
  const authorId = await ghost.getDefaultAuthorId();
  const existing = await ghost.getExistingCanonicalUrls();
  const seenSlugs = new Set<string>();
  for (const url of existing) seenSlugs.add(tenderSlug({ source_url: url }));

  let published = 0;
  const onBatch = async (rows: TenderInput[]): Promise<number> => {
    const { inserted } = await saveTendersToGhost(rows, ghost, seenSlugs, authorId);
    published += inserted;
    return inserted;
  };

  await scrape2merkato(PAGES, existing, onBatch, 1);
  console.log(`[${new Date().toISOString()}] scrape run done — published ${published} new tenders.`);
}

async function loop(): Promise<void> {
  console.log(
    `Ghost tender scraper scheduler: every ${INTERVAL_MS / 60_000} min, pages=${PAGES}.`,
  );
  for (;;) {
    try {
      await runOnce();
    } catch (err) {
      console.error(`scrape run failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
