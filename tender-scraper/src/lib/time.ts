// Convert 2merkato's relative "Posted X ago" label into an absolute instant.
// The site renders e.g. `Posted 7 minutes ago` from a timestamp; when the exact
// timestamp isn't in the page JSON we parse this text instead. Coarse by nature
// (a "3 months ago" only pins the day approximately), so callers should prefer
// an exact JSON timestamp when they have one.

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000, // ~30 days
  year: 31_536_000_000, // ~365 days
};

// Accepts the whole label ("Posted 7 minutes ago") or just the phrase
// ("7 minutes ago"). Returns null if it can't be understood.
export function parseRelativeTime(
  text: string | null | undefined,
  now: Date,
): Date | null {
  if (!text) return null;
  const s = text.toLowerCase().replace(/^posted\s+/, "").trim();

  if (/^(just now|moments? ago|a few seconds ago|seconds ago)$/.test(s)) {
    return new Date(now.getTime());
  }
  if (s === "yesterday") return new Date(now.getTime() - UNIT_MS.day);
  if (s === "today") return new Date(now.getTime());

  // "7 minutes ago" | "a minute ago" | "an hour ago" | "1 day ago"
  const m = s.match(
    /^(\d+|a|an)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/,
  );
  if (!m) return null;
  const n = m[1] === "a" || m[1] === "an" ? 1 : parseInt(m[1], 10);
  const unit = UNIT_MS[m[2]];
  if (!unit || !Number.isFinite(n)) return null;
  return new Date(now.getTime() - n * unit);
}

// Extract the "Posted … ago" phrase from a page's text, or null. Bounded so it
// only captures the short relative label, not surrounding copy.
export function extractPostedPhrase(pageText: string): string | null {
  const m = pageText.match(
    /posted\s+(just now|yesterday|today|(?:\d+|an?|a few)\s*[a-z]*\s*ago)/i,
  );
  return m ? m[1].trim() : null;
}
