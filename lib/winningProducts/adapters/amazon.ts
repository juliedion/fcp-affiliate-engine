import { canonicalizeUrl, normalizeTitle } from "../dedupe";
import { AdapterResult, AdapterSearchParams, CompetitionLevel, RawProductOpportunity, SourceAdapter } from "../types";
import { generateMockProducts, resolveQueries } from "./mockData";
import { inferAudience, inferProblem, inferTraits } from "../inference";

// Real integration via SerpApi's Amazon search engine. The "bought_last_month" field
// Amazon shows on listings ("20K+ bought in past month") is genuine recent sales-velocity
// data — the strongest "this is hot right now" signal available to us, closer to what
// Amazon's own Movers & Shakers page reflects than a static review count. Shares the
// same SerpApi monthly quota as Trends/Shopping, so kept tight per scan.
const MAX_QUERIES_PER_SCAN = 3;
const MIN_REVIEWS_TO_INCLUDE = 25;

type AmazonResult = {
  title: string; asin?: string; link_clean?: string; link?: string; thumbnail?: string;
  rating?: number; reviews?: number; bought_last_month?: string; extracted_price?: number;
};

function parseBoughtLastMonth(text?: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d.]+)(K)?\+?\s*bought/i);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] ? Math.round(n * 1000) : Math.round(n);
}

async function searchAmazon(keyword: string, apiKey: string): Promise<AmazonResult[]> {
  const url = `https://serpapi.com/search.json?engine=amazon&amazon_domain=amazon.com&k=${encodeURIComponent(keyword)}&api_key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  return (data.organic_results ?? []) as AmazonResult[];
}

function demandFromVelocity(boughtLastMonth: number | null, rating: number, reviews: number): number {
  const velocityScore = boughtLastMonth ? Math.min(100, Math.log10(boughtLastMonth + 1) * 22) : 0;
  const reviewScore = Math.min(100, Math.log10(reviews + 1) * 20);
  const ratingScore = Math.min(100, Math.max(0, (rating - 2.5) * 40));
  // Weight recent purchase velocity highest when we have it — it's the freshest signal.
  return boughtLastMonth
    ? Math.round(velocityScore * 0.55 + reviewScore * 0.25 + ratingScore * 0.2)
    : Math.round(reviewScore * 0.65 + ratingScore * 0.35);
}

export const amazonAdapter: SourceAdapter = {
  id: "amazon",
  label: "Amazon (via SerpApi)",
  isConnected() {
    return Boolean(process.env.SERPAPI_KEY);
  },
  async run(params: AdapterSearchParams): Promise<AdapterResult> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      const products = generateMockProducts("amazon", params.categories, Math.min(params.limit, 6));
      return { source: "amazon", products, isMock: true, error: null, requestsUsed: 0 };
    }

    const queries = resolveQueries(params.categories, params.keyword, MAX_QUERIES_PER_SCAN);

    let requestsUsed = 0;
    const errors: string[] = [];
    const products: RawProductOpportunity[] = [];

    for (const { category, keyword } of queries) {
      requestsUsed++;
      try {
        const results = await searchAmazon(keyword, apiKey);
        const validated = results.filter(r => (r.reviews ?? 0) >= MIN_REVIEWS_TO_INCLUDE && r.extracted_price && r.rating);
        const competitionLevel: CompetitionLevel = results.length > 40 ? "high" : results.length > 20 ? "medium" : "low";
        const now = new Date().toISOString();

        const ranked = validated.sort((a, b) => {
          const av = parseBoughtLastMonth(a.bought_last_month) ?? 0;
          const bv = parseBoughtLastMonth(b.bought_last_month) ?? 0;
          if (av !== bv) return bv - av; // prioritize real recent sales velocity when present
          return (b.reviews ?? 0) - (a.reviews ?? 0);
        }).slice(0, Math.max(1, Math.ceil(params.limit / queries.length)));

        for (const item of ranked) {
          const rating = item.rating!;
          const reviews = item.reviews!;
          const price = item.extracted_price!;
          const boughtLastMonth = parseBoughtLastMonth(item.bought_last_month);
          const title = item.title;
          const url = item.link_clean || item.link || `https://www.amazon.com/s?k=${encodeURIComponent(title)}`;
          const demandScore = demandFromVelocity(boughtLastMonth, rating, reviews);

          products.push({
            id: `amazon-${item.asin || normalizeTitle(title)}-${Date.now()}`,
            title, url, image: item.thumbnail || null, source: "amazon", supplier: "Amazon Marketplace",
            category,
            supplierCost: { value: null, quality: "unavailable", source: "amazon", collectedAt: now },
            retailPrice: { value: price, quality: "observed", source: "amazon", collectedAt: now },
            estimatedSellingPrice: price,
            estimatedProfit: null,
            estimatedMargin: null,
            shippingDays: { value: null, quality: "unavailable", source: "amazon", collectedAt: now },
            rating: { value: rating, quality: "observed", source: "amazon", collectedAt: now },
            reviewCount: { value: reviews, quality: "observed", source: "amazon", collectedAt: now },
            reviewGrowth: { value: null, quality: "unavailable", source: "amazon", collectedAt: now },
            searchTrend: {
              value: boughtLastMonth ? `${item.bought_last_month} — ${reviews.toLocaleString()} total reviews` : `${reviews.toLocaleString()} total reviews (no recent-purchase data)`,
              quality: "observed", source: "amazon", collectedAt: now
            },
            socialEngagement: { value: null, quality: "unavailable", source: "amazon", collectedAt: now },
            adActivity: { value: null, quality: "unavailable", source: "amazon", collectedAt: now },
            competitionLevel,
            competingSellers: { value: results.length, quality: "observed", source: "amazon", collectedAt: now },
            firstDetected: now,
            lastDetected: now,
            seasonalRelevance: category === "Seasonal" ? "seasonal" : "evergreen",
            targetAudience: inferAudience(category),
            problemSolved: inferProblem(category),
            ...inferTraits(title, category),
            impulseFriendly: price <= 35,
            isMock: false,
            scoringInputs: { demandTrendScore: demandScore, socialMomentumScore: Math.round(demandScore * 0.6), ratingScore: Math.round(((rating - 3) / 2) * 100), supplierReliabilityScore: 60 },
            evidenceSeed: [
              { label: "Amazon — validated listing", detail: `Real Amazon listing: $${price.toFixed(2)}, ${rating}★, ${reviews.toLocaleString()} reviews${boughtLastMonth ? `, ${item.bought_last_month}` : ""} — genuine recent sales signal, not an estimate.`, source: "amazon", quality: "observed", timestamp: now },
              { label: "No supplier cost", detail: "This is a live retail listing, not a supplier price — connect CJdropshipping or a supplier feed to find a wholesale source for something similar.", source: "amazon", quality: "unavailable", timestamp: now }
            ],
            confidenceHint: boughtLastMonth ? "high" : "medium",
            matchKeys: { canonicalUrl: canonicalizeUrl(url), normalizedTitle: normalizeTitle(title), supplierProductId: null, upc: null, sku: null, asin: item.asin || null }
          });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Failed to search "${keyword}".`);
      }
    }

    return { source: "amazon", products, isMock: false, error: errors.length ? errors.join(" ") : null, requestsUsed };
  }
};
