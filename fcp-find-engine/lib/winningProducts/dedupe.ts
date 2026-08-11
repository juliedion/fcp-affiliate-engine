import { ProductOpportunity } from "./types";

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "tag", "aff"].forEach(p => u.searchParams.delete(p));
    // Some sources (e.g. Google Trends) distinguish products only by query params
    // (?q=keyword) rather than the path — keep whatever's left after stripping
    // tracking params, sorted, so those products don't all collide on one canonical URL.
    u.searchParams.sort();
    const search = u.searchParams.toString();
    const base = `${u.hostname.replace(/^www\./, "")}${u.pathname}`.replace(/\/$/, "").toLowerCase();
    return search ? `${base}?${search.toLowerCase()}` : base;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|new|pro|premium|set|kit|pack|of|for)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Finds an existing product that matches by any of: canonical URL, supplier product ID,
// UPC, SKU, ASIN, or a close normalized-title match. Image similarity is not computed
// client-side (no vision model available here) — flagged as unsupported below.
export function findDuplicate(existing: ProductOpportunity[], candidate: ProductOpportunity): ProductOpportunity | null {
  for (const p of existing) {
    if (p.matchKeys.canonicalUrl && p.matchKeys.canonicalUrl === candidate.matchKeys.canonicalUrl) return p;
    if (candidate.matchKeys.supplierProductId && p.matchKeys.supplierProductId === candidate.matchKeys.supplierProductId) return p;
    if (candidate.matchKeys.upc && p.matchKeys.upc === candidate.matchKeys.upc) return p;
    if (candidate.matchKeys.sku && p.matchKeys.sku === candidate.matchKeys.sku) return p;
    if (candidate.matchKeys.asin && p.matchKeys.asin === candidate.matchKeys.asin) return p;
  }
  // Fall back to a fuzzy normalized-title match within the same source (titles alone are weak evidence across sources).
  for (const p of existing) {
    if (p.source === candidate.source && p.matchKeys.normalizedTitle === candidate.matchKeys.normalizedTitle) return p;
  }
  return null;
}

export const IMAGE_SIMILARITY_SUPPORTED = false;
