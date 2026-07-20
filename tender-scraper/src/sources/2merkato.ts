import { CheerioCrawler } from "crawlee";
import type { TenderInput } from "../lib/types";
import { parseRelativeTime, extractPostedPhrase } from "../lib/time";
import {
  merkatoLogin,
  cookieHeaderFor,
  UA,
  type MerkatoSession,
} from "../lib/merkato-auth";

// tender.2merkato.com is an Inertia.js (Laravel + Vue) app. The tender LIST is
// server-embedded in `<div id="app" data-page="…">`, but the category lives
// only on each tender's DETAIL page (props.tender.categories) — so we crawl:
// list page → enqueue each open tender's detail → read category + description.
// Authenticated (MERKATO_USERNAME/PASSWORD) the closing dates are visible.
// Legal: public listing metadata + attribution link; no paywalled docs.
const BASE = "https://tender.2merkato.com";
const SOURCE_NAME = "2merkato";
// Explicit spacing between requests. maxRequestsPerMinute is a per-minute
// budget that can still micro-burst; a hard sleep guarantees true spacing so
// 2merkato never returns 429.
const REQUEST_DELAY_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type NamePair = { name_en?: string | null; name?: string | null };
type RawSource = { name_en?: string | null; publication_date?: string | null };
type RawTender = {
  id: string;
  title: string | null;
  description: string | null;
  ai_summary: string | null;
  bid_closing_date: string | null;
  published_at: string | null;
  created_at: string | null;
  bid_bond: string | number | null;
  bid_document_price: string | number | null;
  sources: RawSource[] | null;
  company: NamePair | null;
  region: NamePair | string | null;
  categories: RawCategory[] | RawCategory | string | null;
  is_open: boolean;
};

function toDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// A timestamp string (with time) → normalized ISO, or null if unparseable.
function toIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function nameOf(v: NamePair | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.trim() || null;
  return v.name_en ?? v.name ?? null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 80);
}

type Cat = { slug: string; name: string };
type RawCategory = {
  id?: string | null;
  name_en?: string | null;
  name?: string | null;
};

const catName = (n: unknown): string => {
  if (typeof n === "string") return n.trim();
  const o = n as { en?: string; name_en?: string; am?: string } | null;
  return (o?.en ?? o?.name_en ?? o?.am ?? "").trim();
};

// Fetch 2merkato's full category taxonomy once. Returns:
//   parentById — each child category's 2merkato id → its parent {slug,name}.
//     2merkato reuses child NAMES across parents, so we key on the stable id to
//     pick the right parent and reproduce a tender's "Filed Under" tree exactly.
// Ghost tags are flat, so unlike the Supabase scraper there's no ordered
// taxonomy to sync — we only need the child→parent map to enrich each tender's
// category tags with their parent category.
async function fetchTaxonomy(
  session: MerkatoSession,
): Promise<{ parentById: Map<string, Cat> }> {
  const parentById = new Map<string, Cat>();
  try {
    const r = await fetch(`${BASE}/api/v1/categories`, {
      headers: { "User-Agent": UA, Cookie: cookieHeaderFor(session), Accept: "application/json" },
    });
    const arr = (await r.json()) as {
      name: unknown;
      children?: { id?: string; name?: unknown; name_en?: unknown }[];
    }[];
    for (const parent of arr) {
      const pname = catName(parent.name);
      const pslug = slugify(pname);
      if (!pslug) continue;
      for (const child of parent.children ?? []) {
        if (child.id) parentById.set(String(child.id), { slug: pslug, name: pname });
      }
    }
  } catch {
    /* taxonomy unavailable — fall back to leaf categories only */
  }
  return { parentById };
}

// A tender's full "Filed Under" set: every tagged (leaf) category plus its
// parent (looked up by the leaf's 2merkato id). First entry = primary.
function expandCategories(
  cats: RawCategory[] | RawCategory | string | null,
  parentById: Map<string, Cat>,
): Cat[] {
  const arr = Array.isArray(cats) ? cats : cats ? [cats] : [];
  const seen = new Set<string>();
  const out: Cat[] = [];
  const add = (c: Cat) => {
    if (c.slug && !seen.has(c.slug)) {
      seen.add(c.slug);
      out.push(c);
    }
  };
  for (const c of arr) {
    if (typeof c === "string") {
      const n = c.trim();
      if (n) add({ slug: slugify(n), name: n });
      continue;
    }
    const name = catName(c.name_en) || catName(c.name);
    if (!name) continue;
    add({ slug: slugify(name), name });
    const parent = c.id ? parentById.get(String(c.id)) : undefined;
    if (parent) add(parent);
  }
  return out;
}

// Preserve 2merkato's description formatting by keeping a safe whitelist of
// tags — including TABLES (auction/bid schedules) — so the detail page renders
// it the way 2merkato does. All attributes are dropped except a hardened set:
// text-align (closed value set) and numeric colspan/rowspan. No scripts/links.
const ALLOWED_TAGS =
  /^\/?(?:p|br|strong|b|em|i|u|ul|ol|li|h[3-6]|span|table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col)$/i;

function safeAlign(attrs: string): string {
  const m = attrs.match(/text-align\s*:\s*(left|right|center|justify)/i);
  return m ? ` style="text-align:${m[1].toLowerCase()}"` : "";
}
function safeSpans(attrs: string): string {
  let out = "";
  const cs = attrs.match(/colspan\s*=\s*["']?(\d{1,3})/i);
  const rs = attrs.match(/rowspan\s*=\s*["']?(\d{1,3})/i);
  if (cs) out += ` colspan="${cs[1]}"`;
  if (rs) out += ` rowspan="${rs[1]}"`;
  return out;
}

function formatDescription(html: string | null | undefined): string | null {
  if (!html) return null;
  const s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, "")
    .replace(/<(\/?)([a-zA-Z0-9]+)\b([^>]*)>/g, (_m, slash, tag, attrs) => {
      const t = tag.toLowerCase();
      if (!ALLOWED_TAGS.test(`${slash}${t}`)) return "";
      if (slash) return `</${t}>`;
      const align = /^(p|td|th|table)$/.test(t) ? safeAlign(attrs) : "";
      const spans = t === "td" || t === "th" ? safeSpans(attrs) : "";
      return `<${t}${align}${spans}>`;
    })
    // Wrap tables so wide ones scroll horizontally on mobile.
    .replace(/<table(\s[^>]*)?>/g, '<div class="tw"><table$1>')
    .replace(/<\/table>/g, "</table></div>")
    .replace(/(\s*\n\s*){3,}/g, "\n\n")
    .trim();
  return s || null;
}

function toStr(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim() || null;
}

// "Published on": the source publication date(s), e.g. "Jul 15, 2026".
function publishedOn(sources: RawSource[] | null): string | null {
  if (!Array.isArray(sources)) return null;
  const dates = sources
    .map((s) => s.publication_date?.trim())
    .filter((d): d is string => Boolean(d));
  return dates.length ? [...new Set(dates)].join(", ") : null;
}

// Scrapes open AND closed tenders. Crawls `maxPages` list pages starting at
// `startPage`, or until the archive ends. Results are flushed to `onBatch` in
// batches DURING the crawl, so a timeout/cancel still persists progress (and
// the next run skips what's saved). Returns the total rows flushed.
export async function scrape2merkato(
  maxPages = 500,
  existingUrls: Set<string> = new Set(),
  onBatch?: (rows: TenderInput[]) => Promise<number>,
  startPage = 1,
): Promise<number> {
  let stopped = false;
  const username = process.env.MERKATO_USERNAME;
  const password = process.env.MERKATO_PASSWORD;

  let session: MerkatoSession | null = null;
  if (username && password) {
    session = await merkatoLogin(username, password);
    console.log("2merkato: authenticated as subscriber.");
  } else {
    console.log(
      "2merkato: no MERKATO_USERNAME/PASSWORD — public tenders only (most deadlines hidden).",
    );
  }

  // Fetch the child→parent category map so each tender's "Filed Under" leaf tags
  // also carry their parent category. (Ghost tags are flat — no taxonomy sync.)
  const { parentById: categoryParents } = session
    ? await fetchTaxonomy(session)
    : { parentById: new Map<string, Cat>() };
  if (categoryParents.size)
    console.log(`2merkato: loaded ${categoryParents.size} child→parent mappings.`);

  // Flush scraped rows in batches so progress survives a timeout/cancel.
  const BATCH_SIZE = 50;
  let buffer: TenderInput[] = [];
  let totalFlushed = 0;
  const flush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    totalFlushed += onBatch ? await onBatch(batch) : batch.length;
  };

  const crawler = new CheerioCrawler({
    // Gentle: one request at a time, ~500ms apart (120/min). 2merkato 429s
    // after bursts (~168 requests), so sequential + spaced avoids it entirely.
    maxConcurrency: 1,
    maxRequestsPerMinute: 120,
    maxRequestRetries: 5,
    requestHandlerTimeoutSecs: 60,
    preNavigationHooks: [
      async (_ctx, gotOptions) => {
        await sleep(REQUEST_DELAY_MS); // hard 500ms spacing between requests
        gotOptions.headers = {
          ...gotOptions.headers,
          "User-Agent": UA,
          ...(session ? { Cookie: cookieHeaderFor(session) } : {}),
        };
      },
    ],
    async requestHandler({ $, request, log, addRequests }) {
      const raw = $("#app").attr("data-page");
      if (!raw) {
        log.warning(`no data-page at ${request.url}`);
        return;
      }
      let page: {
        props?: { tenders?: { data?: RawTender[] }; tender?: RawTender };
      };
      try {
        page = JSON.parse(raw);
      } catch {
        log.warning(`unparseable data-page JSON at ${request.url}`);
        return;
      }

      // DETAIL page: enrich the partial from userData with category + description.
      if (request.label === "detail") {
        const t = page.props?.tender;
        const base = request.userData.partial as TenderInput;
        if (t) {
          const cats = expandCategories(t.categories, categoryParents);
          if (cats.length) base.categories = cats;
          base.description =
            formatDescription(t.description) ??
            formatDescription(t.ai_summary) ??
            null;
          // Detail values are more complete than the list; override.
          base.bid_bond = toStr(t.bid_bond) ?? base.bid_bond;
          base.bid_document_price =
            toStr(t.bid_document_price) ?? base.bid_document_price;
          base.published_on = publishedOn(t.sources) ?? base.published_on;
          // Convert the visible "Posted X ago" label to an exact instant (date +
          // time). Prefer it when present; fall back to the JSON timestamp.
          const postedFromLabel = parseRelativeTime(
            extractPostedPhrase($("#app").text()),
            new Date(),
          );
          base.posted_at =
            postedFromLabel?.toISOString() ??
            toIso(t.created_at ?? t.published_at) ??
            base.posted_at ??
            null;
        }
        buffer.push(base);
        if (buffer.length >= BATCH_SIZE) await flush();
        return;
      }

      // LIST page: enqueue a detail request per tender. The list URL is filtered
      // to ?status=open, so the feed only contains open tenders; paging stops at
      // the first empty page (end of the open set) or the maxPages cap below.
      const list = page.props?.tenders?.data ?? [];
      const pageNum = Number(
        new URL(request.url).searchParams.get("page") ?? "1",
      );
      const details: { url: string; label: string; userData: object }[] = [];
      let newOnPage = 0;
      for (const t of list) {
        // The feed is already ?status=open, so no per-row is_open filter needed.
        const sourceUrl = `${BASE}/tenders/${t.id}`;
        if (existingUrls.has(sourceUrl)) continue; // already scraped — skip
        const title = t.title?.trim();
        const deadline = toDate(t.bid_closing_date);
        if (!title || !deadline) continue;
        newOnPage++;

        const partial: TenderInput = {
          title,
          description:
            formatDescription(t.description) ?? formatDescription(t.ai_summary),
          region: nameOf(t.region),
          publishing_entity: nameOf(t.company),
          published_date: toDate(t.published_at ?? t.created_at),
          deadline,
          source_name: SOURCE_NAME,
          source_url: sourceUrl,
          categories: expandCategories(t.categories, categoryParents),
          bid_bond: toStr(t.bid_bond),
          bid_document_price: toStr(t.bid_document_price),
          published_on: publishedOn(t.sources),
          posted_at: toIso(t.created_at ?? t.published_at),
        };
        details.push({ url: sourceUrl, label: "detail", userData: { partial } });
      }
      log.info(`page ${pageNum}: ${list.length} rows, ${newOnPage} new`);

      // Page until the archive ends (empty page) or we've crawled maxPages
      // pages this run (relative to startPage).
      const pagesCrawled = pageNum - startPage + 1;
      if (!stopped && list.length > 0 && pagesCrawled < maxPages) {
        await addRequests(
          [{ url: `${BASE}/tenders?status=open&page=${pageNum + 1}`, label: "list" }],
          { forefront: true },
        );
      } else if (!stopped) {
        stopped = true;
        log.info(
          `stopping at page ${pageNum}: ${list.length === 0 ? "end of archive" : "reached max pages cap"}.`,
        );
      }
      await addRequests(details);
    },
    failedRequestHandler({ request, log }) {
      log.error(`request failed after retries: ${request.url}`);
    },
  });

  // Start at startPage; each list page chains the next until the cap/end.
  await crawler.run([`${BASE}/tenders?status=open&page=${startPage}`]);
  await flush(); // persist the final partial batch

  return totalFlushed;
}
