#!/usr/bin/env bash
# Re-index all Ghost tenders into Meilisearch. Run from anywhere:
#   /Users/nathanamare/Downloads/Ghost-main/tender-scraper/reindex.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="/Users/nathanamare/Downloads/Qellal_tender/.env.local"
GHOST_KEY_FILE="/Users/nathanamare/Downloads/Qellal_tender/scrapers/.ghost-admin-key"

export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

# Load MEILI_HOST / MEILI_MASTER_KEY etc. from the gitignored env file.
set -a; . "$ENV_FILE"; set +a

export GHOST_ADMIN_API_URL="${GHOST_ADMIN_API_URL:-http://localhost:2368}"
export GHOST_ADMIN_API_KEY="$(cat "$GHOST_KEY_FILE")"

cd "$DIR"
npm run meili:index
