# Ghost tender scraper

A **standalone** Crawlee-based scraper that pulls Ethiopian tenders from
[2merkato](https://tender.2merkato.com) and publishes each one as a **Ghost
post** via the Admin API. Ghost-native and self-contained — no Supabase, no
Meilisearch. Modeled on the Qellal (Supabase) scraper, kept as a separate
project so it can target a Ghost site directly.

Lives inside the Ghost repo at `tender-scraper/` but is **not** part of the pnpm
workspace / Nx build (it isn't matched by any workspace glob) — it has its own
`package.json` and `node_modules`.

## What each tender becomes

| Tender field | Ghost post |
| --- | --- |
| `title` | post title (truncated to 255) |
| `description` (HTML) | post body |
| `deadline`, `region`, `publishing_entity`, `bid_bond`, `bid_document_price`, `published_on`, `posted_at` | a **"Tender details"** facts block appended to the body |
| `source_url` | `canonical_url` + a "View the original notice" attribution link + the dedupe key |
| `published_at`/`posted_at` | post `published_at` |
| categories + `region` + language + `source_name` | post **tags** |

- **Language tag** is auto-detected per tender (Ethiopic script → `Amharic`,
  otherwise `English`) since 2merkato has no language field.
- **Dedupe** is idempotent: each post gets a stable `tender-<noticeId>` slug
  derived from `source_url`, and already-published notices are skipped, so it's
  safe to re-run and to resume after an interruption.

## Setup

```bash
cd tender-scraper
npm install
cp .env.example .env   # fill in GHOST_ADMIN_API_URL + GHOST_ADMIN_API_KEY
```

Get the Admin API key from Ghost: **Settings → Advanced → Integrations → Add
custom integration**. Copy the **Admin API Key** (shown as `<id>:<hex-secret>`).

## Run

```bash
# Dry run — extract + print, publishes nothing (no Ghost creds needed):
DRY_RUN=1 npm run scrape -- 2merkato 3

# Real run — publishes new tenders as Ghost posts:
export GHOST_ADMIN_API_URL=http://localhost:2368
export GHOST_ADMIN_API_KEY=<id>:<hexsecret>
export MERKATO_USERNAME=… MERKATO_PASSWORD=…   # optional, unlocks deadlines
npm run scrape -- 2merkato 500
```

## Scheduling — two ways (run either or both)

1. **GitHub Actions** (`.github/workflows/scrape.yml`) — every 6h. Requires repo
   secrets `GHOST_ADMIN_API_URL`, `GHOST_ADMIN_API_KEY`, and optionally
   `MERKATO_USERNAME` / `MERKATO_PASSWORD`. Manual runs default to a dry run.

2. **Background job alongside Ghost** (`npm run schedule`) — a long-running
   process that re-scrapes every `SCRAPE_INTERVAL_MINUTES` (default 360). Deploy
   it as a systemd/launchd service, a pm2 process, or a Docker sidecar next to
   Ghost. Example systemd unit:

   ```ini
   [Service]
   WorkingDirectory=/opt/ghost/tender-scraper
   Environment=GHOST_ADMIN_API_URL=https://your-ghost-site.com
   Environment=GHOST_ADMIN_API_KEY=<id>:<hexsecret>
   Environment=SCRAPE_INTERVAL_MINUTES=360
   ExecStart=/usr/bin/npm run schedule
   Restart=always
   ```

## Adding a source

1. Create `src/sources/<name>.ts` exporting
   `async (pages, existingUrls, onBatch, startPage) => Promise<number>`, emitting
   `TenderInput` rows (see `src/lib/types.ts`).
2. Register it in `SOURCES` in `src/main.ts`.
3. Always set `source_name` + `source_url` (attribution + dedupe).

## Legal

Public listing metadata + an attribution link back to the original notice only.
The paywalled bid documents are never downloaded.
