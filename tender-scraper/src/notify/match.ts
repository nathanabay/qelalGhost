// Matching a tender against a saved alert's criteria.
//  • factsFromPost(): pull the fields we match on out of a Ghost post.published
//    webhook payload (tags + custom_excerpt).
//  • matches(): does a single tender satisfy a criteria set? (for instant alerts)
//  • queryMeili(): find tenders matching a criteria set across the whole corpus
//    (for daily digests + deadline reminders), reusing the ghost_tenders index.

import { meiliSynonyms } from "../lib/synonyms";
import type { Config } from "./config";
import type { Criteria } from "./store";

const SYN = meiliSynonyms();

// Special tag-slug prefixes/values that are NOT sector categories.
const NON_CATEGORY = new Set(["english", "amharic", "2merkato", "featured", "proforma"]);
function isCategorySlug(slug: string): boolean {
  return !slug.startsWith("entity-") && !slug.startsWith("region-") && !NON_CATEGORY.has(slug);
}

export function todayStartTs(): number {
  const n = new Date();
  return Math.floor(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) / 1000);
}

// Expand a free-text query to its synonym siblings, return a matcher regex.
function keywordRegex(q: string): RegExp | null {
  const words = q.toLowerCase().split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (!words.length) return null;
  const terms = new Set<string>();
  for (const w of words) {
    terms.add(w);
    for (const syn of SYN[w] || []) terms.add(syn);
  }
  const esc = [...terms].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("(" + esc.join("|") + ")", "i");
}

export type TenderFacts = {
  id: string; // post slug (tender-*)
  title: string;
  url: string;
  excerpt: string;
  categorySlugs: string[];
  region: string | null;
  publishing_entity: string | null;
  deadlineTs: number | null;
  deadline: string | null;
};

type WebhookTag = { slug?: string; name?: string };
type WebhookPost = {
  slug?: string; title?: string; url?: string; excerpt?: string; custom_excerpt?: string;
  tags?: WebhookTag[];
};

export function factsFromPost(post: WebhookPost): TenderFacts | null {
  const slug = post.slug || "";
  if (!slug.startsWith("tender-")) return null;
  const tags = post.tags || [];
  const region = tags.find((t) => (t.slug || "").startsWith("region-"))?.name || null;
  const entity = tags.find((t) => (t.slug || "").startsWith("entity-"))?.name || null;
  const categorySlugs = tags.filter((t) => isCategorySlug(t.slug || "")).map((t) => t.slug as string);
  const excerpt = post.custom_excerpt || post.excerpt || "";
  const m = excerpt.match(/Deadline\s+(\d{4}-\d{2}-\d{2})/i);
  const deadline = m ? m[1] : null;
  const ts = deadline ? Math.floor(Date.parse(deadline) / 1000) : null;
  return {
    id: slug, title: post.title || "", url: post.url || "", excerpt,
    categorySlugs, region, publishing_entity: entity, deadline, deadlineTs: Number.isNaN(ts as number) ? null : ts,
  };
}

export function matches(t: TenderFacts, c: Criteria, includeClosed: boolean): boolean {
  const today = todayStartTs();
  if (!includeClosed && t.deadlineTs != null && t.deadlineTs < today) return false;
  if (c.closed === "0" && t.deadlineTs != null && t.deadlineTs < today) return false;
  if (c.cat && !t.categorySlugs.includes(c.cat)) return false;
  if (c.region && (t.region || "").toLowerCase() !== c.region.toLowerCase()) return false;
  if (c.deadline) {
    const days = Number(c.deadline);
    if (days > 0) {
      if (t.deadlineTs == null) return false;
      if (t.deadlineTs < today || t.deadlineTs > today + days * 86400) return false;
    }
  }
  if (c.q) {
    const re = keywordRegex(c.q);
    if (re && !re.test(`${t.title} ${t.excerpt}`)) return false;
  }
  return true;
}

export type MeiliHit = { id: string; url: string; title: string; deadline: string | null; deadline_ts: number; publishing_entity: string | null; region: string | null };

// Query the ghost_tenders index for tenders matching a criteria set. Optional
// windows: `sinceTs` (published after — for digests), `deadlineDay` (deadline
// falls on exactly that UTC day — for T-N reminders).
export async function queryMeili(
  cfg: Config,
  c: Criteria & { catName?: string },
  opts: { sinceTs?: number; deadlineDay?: number; limit?: number } = {},
): Promise<MeiliHit[]> {
  if (!cfg.meiliHost || !cfg.meiliKey) return [];
  const filters: string[] = [];
  if (c.catName) filters.push(`categories = "${c.catName.replace(/"/g, '\\"')}"`);
  if (c.region) filters.push(`region = "${c.region.replace(/"/g, '\\"')}"`);
  if (c.closed === "0" || !cfg.policy.includeClosed) filters.push("open_rank = 0");
  if (opts.sinceTs) filters.push(`published_ts >= ${opts.sinceTs}`);
  if (opts.deadlineDay != null) filters.push(`deadline_ts >= ${opts.deadlineDay} AND deadline_ts < ${opts.deadlineDay + 86400}`);
  if (c.deadline && opts.deadlineDay == null) {
    const days = Number(c.deadline);
    if (days > 0) { const t = todayStartTs(); filters.push(`deadline_ts >= ${t} AND deadline_ts <= ${t + days * 86400}`); }
  }
  const body = {
    q: c.q || "",
    limit: opts.limit || 25,
    sort: ["published_ts:desc"],
    filter: filters.length ? filters.join(" AND ") : undefined,
    attributesToRetrieve: ["id", "url", "title", "deadline", "deadline_ts", "publishing_entity", "region"],
  };
  try {
    const r = await fetch(`${cfg.meiliHost}/indexes/${cfg.meiliIndex}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.meiliKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = (await r.json()) as { hits?: MeiliHit[] };
    return d.hits || [];
  } catch {
    return [];
  }
}
