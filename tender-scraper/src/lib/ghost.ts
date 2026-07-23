// Ghost sink — turns a scraped tender into a Ghost post via the Admin API.
//
// Every 2merkato field is preserved: the human-readable description stays as the
// post body, and a "Tender details" facts block captures deadline / region /
// publishing entity / bid bond / document price / dates + a legal attribution
// link, so nothing is lost.
//
// Tags per post = its 2merkato categories + region + language + source. Ghost
// finds-or-creates tags by name, so the tag vocabulary is seeded automatically
// as posts are published — there is no separate taxonomy to sync.
//
// Auth is a hand-rolled Admin API JWT (HS256, kid = key id, secret = hex) so the
// package needs no extra dependency.

import crypto from "node:crypto";
import type { TenderInput } from "./types";

export type GhostPost = {
  title: string;
  slug: string;
  html: string;
  status: "published" | "draft";
  custom_excerpt?: string;
  canonical_url?: string;
  published_at?: string;
  tags: { name: string; slug?: string }[];
  authors?: { id: string }[];
};

const TITLE_MAX = 255;
const EXCERPT_MAX = 300;
const TAG_MAX = 191;

// Ethiopic Unicode block → Amharic, otherwise English. Best-effort: 2merkato has
// no language field, so we detect from the tender's own text.
export function detectLanguage(t: TenderInput): "Amharic" | "English" {
  const text = `${t.title ?? ""} ${t.description ?? ""}`;
  return /[ሀ-፿]/.test(text) ? "Amharic" : "English";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A stable, idempotent slug from the 2merkato notice id in the source_url, so
// re-running the scraper never creates duplicates. Falls back to a hash of the
// url when it doesn't carry a recognizable notice id.
export function tenderSlug(t: Pick<TenderInput, "source_url">): string {
  const m = t.source_url?.match(/([a-f0-9]{16,})\/?$/i);
  const id = m ? m[1] : crypto.createHash("sha1").update(t.source_url).digest("hex").slice(0, 24);
  return `tender-${id}`.slice(0, 185);
}

// Tags = categories (primary first) + region + language + source. Deduped,
// trimmed, capped at Ghost's 191-char tag-name limit.
// Slug for an entity tag: latinises what it can, hashes non-latin (Amharic)
// names so every company still gets a stable, unique "entity-*" slug.
function entitySlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 170);
  const sl = base || crypto.createHash("sha1").update(name).digest("hex").slice(0, 16);
  return `entity-${sl}`;
}

// Region gets its own "region-*" slug (like entity-*) so the theme/indexer can
// treat it as a first-class facet, separate from the sector category tags.
export function regionSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const sl = base || crypto.createHash("sha1").update(name).digest("hex").slice(0, 16);
  return `region-${sl}`;
}

export function tenderTags(t: TenderInput): { name: string; slug?: string }[] {
  const raw: { name: string; slug?: string }[] = [];
  for (const c of t.categories) if (c?.name) raw.push({ name: c.name });
  if (t.region) raw.push({ name: t.region, slug: regionSlug(t.region) });
  raw.push({ name: detectLanguage(t) });
  if (t.source_name) raw.push({ name: t.source_name });
  // The publishing entity is a tag too, with an explicit "entity-*" slug so the
  // theme can hide it from the category chips and link to it as a company page.
  if (t.publishing_entity) {
    raw.push({ name: t.publishing_entity, slug: entitySlug(t.publishing_entity) });
  }
  // 2merkato promotion / type flags, as their own slugs so the theme + indexer
  // can treat them specially (a Featured rail, a Proforma badge).
  if (t.featured) raw.push({ name: "Featured", slug: "featured" });
  if (t.proforma) raw.push({ name: "Proforma", slug: "proforma" });

  const seen = new Set<string>();
  const tags: { name: string; slug?: string }[] = [];
  for (const item of raw) {
    const name = item.name.trim().slice(0, TAG_MAX);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    tags.push(item.slug ? { name, slug: item.slug } : { name });
  }
  return tags;
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}
function hm(s: string | null | undefined): string | null {
  const m = s ? String(s).match(/\b(\d{2}):(\d{2})\b/) : null;
  return m ? `${m[1]}:${m[2]}` : null;
}
function dateHm(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = String(s).slice(0, 10);
  const t = hm(s);
  return t ? `${d} ${t}` : d;
}

// The "Tender details" facts block + a Documents list. Shared by tenderHtml (new
// posts) and the enrichment backfill (existing posts) so both render identically.
export function tenderFactsHtml(t: TenderInput): string {
  const rows: [string, string | null][] = [
    ["Deadline", t.deadline],
    ["Bid closing time", hm(t.bid_closing_at)],
    ["Bid closing (note)", t.bid_closing_text ?? null],
    ["Bid opening", dateHm(t.bid_opening_at)],
    ["Bid opening (note)", t.bid_opening_text ?? null],
    ["Region", t.region],
    ["Publishing entity", t.publishing_entity],
    ["Buyer TIN", t.company_tin ?? null],
    ["Buyer phone", t.company_phone ?? null],
    ["Buyer address", t.company_address ?? null],
    ["Bid bond", t.bid_bond],
    ["Bid document price", t.bid_document_price],
    ["Published", t.published_on ?? t.published_date],
    ["Posted at", t.posted_at],
  ];
  let facts = rows
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(String(v))}</li>`)
    .join("");
  if (t.company_website && t.company_website.trim()) {
    const w = t.company_website.trim();
    const href = /^https?:\/\//i.test(w) ? w : `https://${w}`;
    facts += `<li><strong>Buyer website:</strong> <a href="${escAttr(href)}" target="_blank" rel="noopener nofollow">${esc(w)}</a></li>`;
  }
  const factsBlock = facts ? `<hr><h3>Tender details</h3><ul>${facts}</ul>` : "";
  const docs = (t.documents ?? []).filter((d) => d && d.url);
  const docsBlock = docs.length
    ? `<h3>Documents</h3><ul>${docs
        .map(
          (d) =>
            `<li><a href="${escAttr(d.url)}" target="_blank" rel="noopener nofollow">${esc(d.name || "Document")}</a></li>`,
        )
        .join("")}</ul>`
    : "";
  return [factsBlock, docsBlock].filter(Boolean).join("\n");
}

// The post body: original description (already sanitized HTML) + the facts block.
// The source_url is preserved as the post's canonical_url (legal attribution),
// and the theme renders a dedicated "Source" card from it.
export function tenderHtml(t: TenderInput): string {
  const body = (t.description ?? "").trim();
  return [body, tenderFactsHtml(t)].filter(Boolean).join("\n");
}

export function tenderExcerpt(t: TenderInput): string | undefined {
  const parts = [t.deadline ? `Deadline ${t.deadline}` : null, t.publishing_entity, t.region].filter(
    Boolean,
  );
  if (parts.length === 0) return undefined;
  return parts.join(" · ").slice(0, EXCERPT_MAX);
}

// Pure mapping: TenderInput → Ghost post payload.
export function tenderToPost(t: TenderInput, authorId?: string): GhostPost {
  const post: GhostPost = {
    title: (t.title ?? "Untitled tender").trim().slice(0, TITLE_MAX),
    slug: tenderSlug(t),
    html: tenderHtml(t),
    status: "published",
    tags: tenderTags(t),
  };
  const excerpt = tenderExcerpt(t);
  if (excerpt) post.custom_excerpt = excerpt;
  if (t.source_url) post.canonical_url = t.source_url;
  const publishedAt = t.posted_at ?? (t.published_date ? `${t.published_date}T00:00:00Z` : null);
  if (publishedAt) post.published_at = new Date(publishedAt).toISOString();
  if (authorId) post.authors = [{ id: authorId }];
  return post;
}

// ── Admin API client ────────────────────────────────────────────────────────

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export class GhostAdminClient {
  private url: string;
  private keyId: string;
  private secret: string;
  readonly version: string;

  constructor(opts?: { url?: string; key?: string; version?: string }) {
    const url = opts?.url ?? process.env.GHOST_ADMIN_API_URL;
    const key = opts?.key ?? process.env.GHOST_ADMIN_API_KEY;
    if (!url || !key) {
      throw new Error("GHOST_ADMIN_API_URL and GHOST_ADMIN_API_KEY must be set");
    }
    const [id, secret] = key.split(":");
    if (!id || !secret) {
      throw new Error("GHOST_ADMIN_API_KEY must be in '<id>:<hex-secret>' form");
    }
    this.url = url.replace(/\/+$/, "");
    this.keyId = id;
    this.secret = secret;
    this.version = opts?.version ?? "v5.0";
  }

  private token(): string {
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: this.keyId }));
    const iat = Math.floor(Date.now() / 1000);
    const payload = b64url(JSON.stringify({ iat, exp: iat + 300, aud: "/admin/" }));
    const data = `${header}.${payload}`;
    const sig = b64url(
      crypto.createHmac("sha256", Buffer.from(this.secret, "hex")).update(data).digest(),
    );
    return `${data}.${sig}`;
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.url}/ghost/api/admin${path}`, {
      ...init,
      headers: {
        Authorization: `Ghost ${this.token()}`,
        "Accept-Version": this.version,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }

  // The owner/first staff user, to author published posts.
  async getDefaultAuthorId(): Promise<string | undefined> {
    const r = await this.req("/users/?limit=1&order=created_at%20asc&fields=id");
    if (!r.ok) return undefined;
    const body = (await r.json()) as { users?: { id: string }[] };
    return body.users?.[0]?.id;
  }

  // Every source_url already imported (stored as canonical_url on tender-* posts),
  // so the crawler can skip notices it has already published.
  async getExistingCanonicalUrls(): Promise<Set<string>> {
    const urls = new Set<string>();
    let page = 1;
    for (;;) {
      const r = await this.req(
        `/posts/?limit=100&page=${page}&fields=canonical_url&filter=${encodeURIComponent("slug:~'tender-'")}`,
      );
      if (!r.ok) throw new Error(`list posts failed: ${r.status} ${await r.text()}`);
      const body = (await r.json()) as {
        posts: { canonical_url: string | null }[];
        meta: { pagination: { pages: number } };
      };
      for (const p of body.posts) if (p.canonical_url) urls.add(p.canonical_url);
      if (page >= (body.meta?.pagination?.pages ?? page)) break;
      page += 1;
    }
    return urls;
  }

  // Every existing tender-* slug, for dedupe in the Supabase migration.
  async getExistingTenderSlugs(): Promise<Set<string>> {
    const slugs = new Set<string>();
    let page = 1;
    for (;;) {
      const r = await this.req(
        `/posts/?limit=100&page=${page}&fields=slug&filter=${encodeURIComponent("slug:~'tender-'")}`,
      );
      if (!r.ok) throw new Error(`list posts failed: ${r.status} ${await r.text()}`);
      const body = (await r.json()) as { posts: { slug: string }[]; meta: { pagination: { pages: number } } };
      for (const p of body.posts) slugs.add(p.slug);
      if (page >= (body.meta?.pagination?.pages ?? page)) break;
      page += 1;
    }
    return slugs;
  }

  // Create one post from HTML. Returns the new post's id/url or throws.
  async createPost(post: GhostPost): Promise<{ id: string; url: string }> {
    const r = await this.req("/posts/?source=html", {
      method: "POST",
      body: JSON.stringify({ posts: [post] }),
    });
    if (!r.ok) throw new Error(`create post failed (${r.status}): ${await r.text()}`);
    const body = (await r.json()) as { posts: { id: string; url: string }[] };
    return { id: body.posts[0].id, url: body.posts[0].url };
  }

  // Generic authenticated Admin API GET (path under /ghost/api/admin). Used by
  // the Meili indexer to page through tender posts.
  async adminGet<T = unknown>(path: string): Promise<T> {
    const r = await this.req(path);
    if (!r.ok) throw new Error(`GET ${path} failed (${r.status}): ${await r.text()}`);
    return (await r.json()) as T;
  }

  // Generic authenticated Admin API POST.
  async adminPost<T = unknown>(path: string, body: unknown): Promise<T> {
    const r = await this.req(path, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`POST ${path} failed (${r.status}): ${await r.text()}`);
    return (await r.json()) as T;
  }

  // Generic authenticated Admin API PUT (used by the region backfill to add a
  // tag to an existing post).
  async adminPut<T = unknown>(path: string, body: unknown): Promise<T> {
    const r = await this.req(path, { method: "PUT", body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`PUT ${path} failed (${r.status}): ${await r.text()}`);
    return (await r.json()) as T;
  }
}

// Batch sink used by the crawler's onBatch. Dedupes against `existing` (a slug
// set the caller preloads once and this mutates), and treats a duplicate-slug
// create as a skip so re-runs are idempotent.
export async function saveTendersToGhost(
  rows: TenderInput[],
  client: GhostAdminClient,
  existing: Set<string>,
  authorId?: string,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const t of rows) {
    const slug = tenderSlug(t);
    if (existing.has(slug)) {
      skipped += 1;
      continue;
    }
    try {
      await client.createPost(tenderToPost(t, authorId));
      existing.add(slug);
      inserted += 1;
    } catch (err) {
      const msg = (err as Error).message;
      if (/already exists|duplicate|slug/i.test(msg)) {
        existing.add(slug);
        skipped += 1;
      } else {
        throw err;
      }
    }
  }
  return { inserted, skipped };
}
