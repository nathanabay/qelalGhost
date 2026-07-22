// Bidirectional procurement synonyms for Meilisearch (mirrors scripts/notify.py
// SYNONYM_CLUSTERS). Meili wants a map of term -> [synonyms]; expand each cluster
// so every term maps to its siblings.
const CLUSTERS: string[][] = [
  ["it", "ict", "information technology", "software", "computer", "it support", "help desk", "service desk", "networking"],
  ["construction", "building", "civil works", "contractor", "renovation", "road", "bridge", "infrastructure"],
  ["vehicle", "car", "truck", "automobile", "fleet", "spare parts"],
  ["medical", "medicine", "pharmaceutical", "drugs", "hospital", "clinical", "laboratory", "diagnostic"],
  ["consultancy", "consulting", "consultant", "advisory", "technical assistance", "feasibility study"],
  ["security", "guard", "surveillance", "cctv"],
  ["furniture", "office equipment", "stationery"],
  ["training", "capacity building", "workshop", "seminar"],
  ["cleaning", "sanitation", "janitorial", "hygiene"],
  ["electrical", "electricity", "power", "generator", "solar"],
  ["water", "borehole", "irrigation", "wash", "plumbing"],
  ["catering", "food", "nutrition"],
  ["transport", "logistics", "freight", "shipping", "courier"],
  ["printing", "publishing", "graphic design"],
  ["insurance", "audit", "accounting", "financial services"],
];

export function meiliSynonyms(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const cluster of CLUSTERS) {
    for (const term of cluster) map[term] = cluster.filter((x) => x !== term);
  }
  return map;
}
