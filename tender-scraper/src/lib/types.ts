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
};
