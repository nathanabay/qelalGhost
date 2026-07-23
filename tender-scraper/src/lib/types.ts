// The normalized shape every scraper source produces. Ghost-native: unlike the
// Qellal/Supabase version there is no separate category taxonomy to sync —
// categories (plus region, language, source) simply become Ghost tags, which
// Ghost finds-or-creates on demand as posts are published.
export type TenderInput = {
  title: string;
  description: string | null;
  region: string | null;
  publishing_entity: string | null;
  published_date: string | null; // YYYY-MM-DD
  deadline: string; // YYYY-MM-DD — required
  source_name: string; // legal: attribution always
  source_url: string; // legal: link back to the original notice; also the dedupe key
  bid_bond: string | null;
  bid_document_price: string | null;
  published_on: string | null; // source publication date, e.g. "Jul 15, 2026"
  posted_at: string | null; // precise posting instant (ISO), carries date AND time
  categories: { slug: string; name: string }[]; // first = primary
  // Enriched from the 2merkato detail page (all optional — older constructors omit them).
  bid_opening_at?: string | null; // "YYYY-MM-DD HH:MM:SS" — when bids are opened
  bid_closing_at?: string | null; // full closing datetime (carries the time)
  documents?: { name: string; url: string }[]; // attached tender documents (links)
  company_tin?: string | null;
  company_phone?: string | null;
  company_website?: string | null;
  company_address?: string | null;
  company_logo?: string | null;
  featured?: boolean; // 2merkato is_featured || is_pinned → a "featured" tag
  proforma?: boolean; // 2merkato is_proforma → a "proforma" tag
  bid_closing_text?: string | null; // free-text closing (e.g. "varies per lot")
  bid_opening_text?: string | null; // free-text opening
};
