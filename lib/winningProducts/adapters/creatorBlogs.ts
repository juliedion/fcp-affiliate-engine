import { canonicalizeUrl, normalizeTitle } from "../dedupe";
import { AdapterResult, AdapterSearchParams, FortCategory, RawProductOpportunity, SourceAdapter } from "../types";
import { inferAudience, inferProblem, inferTraits } from "../inference";

// Reads public post titles/links from configured home & lifestyle blogs as a *research
// signal*, not a supplier — these are normal public web pages (same as the existing
// scrapeProduct fetcher), not social platforms. Instagram/Facebook-only accounts are
// deliberately excluded: those platforms' ToS blocks automated scraping of other users'
// profiles/posts, and there's no compliant self-serve API for reading someone else's
// account content. Only add sites here that are ordinary public websites/blogs.
const BLOG_SITES: { name: string; url: string }[] = [
  { name: "Our PNW Home", url: "https://ourpnwhome.com/category/home/" },
  { name: "Money Saving Mom", url: "https://moneysavingmom.com/" }
];

const MAX_POSTS_PER_SITE = 6;

const CATEGORY_KEYWORDS: { category: FortCategory; keywords: string[] }[] = [
  { category: "Home Organization", keywords: ["organiz", "storage", "closet", "shelf", "declutter", "pantry", "bin"] },
  { category: "Kitchen Helpers", keywords: ["kitchen", "cook", "recipe", "utensil", "gadget", "pan", "appliance"] },
  { category: "Cleaning", keywords: ["clean", "mop", "vacuum", "laundry", "stain", "tidy"] },
  { category: "Family Life", keywords: ["family", "budget", "meal plan", "chore", "schedule", "routine", "mom life"] },
  { category: "Kids", keywords: ["kid", "toddler", "toy", "child", "baby"] },
  { category: "Pets", keywords: ["pet", "dog", "cat"] },
  { category: "Outdoor", keywords: ["outdoor", "garden", "patio", "yard", "porch"] },
  { category: "Seasonal", keywords: ["christmas", "holiday", "fall", "summer", "winter", "spring", "decor"] },
  { category: "Everyday Problem Solvers", keywords: ["hack", "tip", "must-have", "favorite", "review"] }
];

function inferCategory(text: string): FortCategory {
  const lower = text.toLowerCase();
  const match = CATEGORY_KEYWORDS.find(c => c.keywords.some(k => lower.includes(k)));
  return match?.category ?? "Everyday Problem Solvers";
}

// Very lightweight HTML parsing (no DOM lib in this project — mirrors the regex-based
// approach already used in lib/scrape.ts) — pulls anchor text + href pairs that look like
// real post titles, filtering out nav/menu links. Prefers WordPress-style dated permalinks
// (/YYYY/MM/DD/slug/) since those reliably identify actual posts rather than category/nav pages.
function extractPostLinks(html: string, baseUrl: string): { title: string; url: string }[] {
  const origin = new URL(baseUrl).origin;
  const matches = Array.from(html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const seen = new Set<string>();
  const results: { title: string; url: string }[] = [];
  const datedPattern = /\/\d{4}\/\d{2}\/\d{2}\//;

  for (const m of matches) {
    let href = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().replace(/\s*read now\W*$/i, "").trim();
    if (!text || text.length < 12 || text.length > 140) continue;
    if (/^(home|about|contact|shop|privacy|terms|subscribe|search|menu|categor(y|ies)|reels?\s*\/?\s*tiktok|shop my home)$/i.test(text)) continue;
    if (href.startsWith("/")) href = origin + href;
    if (!href.startsWith(origin)) continue;
    if (!datedPattern.test(href)) continue; // skip category/nav pages — only real dated posts
    if (seen.has(href)) continue;
    seen.add(href);
    results.push({ title: text, url: href });
    if (results.length >= MAX_POSTS_PER_SITE) break;
  }
  return results;
}

async function fetchPosts(site: { name: string; url: string }): Promise<{ title: string; url: string }[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(site.url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FortCrazypantsBot/1.0; +https://fortcrazypants.com)" }
    });
    if (!r.ok) throw new Error(`${site.name} returned HTTP ${r.status}.`);
    const html = await r.text();
    return extractPostLinks(html, site.url);
  } finally {
    clearTimeout(timeout);
  }
}

export const creatorBlogsAdapter: SourceAdapter = {
  id: "creator_blogs",
  label: "Creator Blogs",
  isConnected() {
    return true; // ordinary public web fetching, no API key required
  },
  async run(params: AdapterSearchParams): Promise<AdapterResult> {
    const products: RawProductOpportunity[] = [];
    const errors: string[] = [];
    let requestsUsed = 0;

    for (const site of BLOG_SITES) {
      requestsUsed++;
      try {
        const posts = await fetchPosts(site);
        const now = new Date().toISOString();
        for (const post of posts) {
          const category = inferCategory(post.title);
          if (params.categories.length && !params.categories.includes(category)) continue;
          if (params.keyword && !post.title.toLowerCase().includes(params.keyword.toLowerCase())) continue;

          products.push({
            id: `creator_blogs-${normalizeTitle(post.title)}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
            title: post.title, url: post.url, image: null, source: "creator_blogs", supplier: null,
            category,
            supplierCost: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            retailPrice: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            estimatedSellingPrice: null,
            estimatedProfit: null,
            estimatedMargin: null,
            shippingDays: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            rating: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            reviewCount: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            reviewGrowth: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            searchTrend: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            socialEngagement: { value: `Featured on ${site.name}`, quality: "observed", source: "creator_blogs", collectedAt: now },
            adActivity: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            competitionLevel: "medium",
            competingSellers: { value: null, quality: "unavailable", source: "creator_blogs", collectedAt: now },
            firstDetected: now,
            lastDetected: now,
            seasonalRelevance: category === "Seasonal" ? "seasonal" : "evergreen",
            targetAudience: inferAudience(category),
            problemSolved: inferProblem(category),
            ...inferTraits(post.title, category),
            impulseFriendly: false,
            isMock: false,
            scoringInputs: { demandTrendScore: 35, socialMomentumScore: 45, ratingScore: 35, supplierReliabilityScore: 30 },
            evidenceSeed: [
              { label: `Featured on ${site.name}`, detail: `"${post.title}" was featured in a post on ${site.name} — a real product-idea signal, not verified sales/demand data. Research a real supplier and pricing separately before listing.`, source: "creator_blogs", quality: "observed", timestamp: now },
              { label: "No price, cost, or demand data", detail: "Creator blogs don't provide pricing, supplier, or sales data — connect Google Trends/Shopping, CJdropshipping, or Zendrop to source and price this idea for real.", source: "creator_blogs", quality: "unavailable", timestamp: now }
            ],
            confidenceHint: "low",
            matchKeys: { canonicalUrl: canonicalizeUrl(post.url), normalizedTitle: normalizeTitle(post.title), supplierProductId: null, upc: null, sku: null, asin: null }
          });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Failed to read ${site.name}.`);
      }
    }

    return { source: "creator_blogs", products, isMock: false, error: errors.length ? errors.join(" ") : null, requestsUsed };
  }
};
