import { canonicalizeUrl, normalizeTitle } from "../dedupe";
import { AdapterResult, AdapterSearchParams, CompetitionLevel, RawProductOpportunity, SourceAdapter } from "../types";
import { generateMockProducts, resolveQueries } from "./mockData";
import { inferAudience, inferProblem, inferTraits } from "../inference";

// Real integration via SerpApi's Google Shopping engine — returns actual retail listings
// with real ratings/review counts/prices, which is a genuine "is this already selling"
// signal (unlike a raw supplier catalog, which has no sales data at all). Shares the same
// SerpApi monthly quota as the Trends adapter, so kept tight per scan.
const MAX_QUERIES_PER_SCAN = 4;
const MIN_REVIEWS_TO_INCLUDE = 15; // filters out brand-new, unvalidated listings

type ShoppingResult = {
  title: string; link?: string; product_link?: string; thumbnail?: string; source?: string;
  extracted_price?: number; rating?: number; reviews?: number;
};

async function searchShopping(keyword: string, apiKey: string): Promise<ShoppingResult[]> {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(keyword)}&api_key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  return (data.shopping_results ?? []) as ShoppingResult[];
}

function demandFromReviews(rating: number, reviews: number): number {
  // Log-scaled so 10 reviews and 10,000 reviews aren't treated linearly, weighted by rating quality.
  const reviewScore = Math.min(100, Math.log10(reviews + 1) * 25);
  const ratingScore = Math.min(100, Math.max(0, (rating - 2.5) * 40));
  return Math.round(reviewScore * 0.65 + ratingScore * 0.35);
}

export const googleShoppingAdapter: SourceAdapter = {
  id: "google_shopping",
  label: "Google Shopping (via SerpApi)",
  isConnected() {
    return Boolean(process.env.SERPAPI_KEY);
  },
  async run(params: AdapterSearchParams): Promise<AdapterResult> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      const products = generateMockProducts("google_shopping", params.categories, Math.min(params.limit, 6));
      return { source: "google_shopping", products, isMock: true, error: null, requestsUsed: 0 };
    }

    const queries = resolveQueries(params.categories, params.keyword, MAX_QUERIES_PER_SCAN);

    let requestsUsed = 0;
    const errors: string[] = [];
    const products: RawProductOpportunity[] = [];

    for (const { category, keyword } of queries) {
      requestsUsed++;
      try {
        const results = await searchShopping(keyword, apiKey);
        const validated = results.filter(r => (r.reviews ?? 0) >= MIN_REVIEWS_TO_INCLUDE && r.extracted_price && r.rating);
        const competitionLevel: CompetitionLevel = results.length > 30 ? "high" : results.length > 15 ? "medium" : "low";
        const now = new Date().toISOString();

        // Take the top few validated (already-selling) listings for this category, ranked by review count.
        const top = validated.sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0)).slice(0, Math.max(1, Math.ceil(params.limit / queries.length)));

        for (const item of top) {
          const rating = item.rating!;
          const reviews = item.reviews!;
          const price = item.extracted_price!;
          const title = item.title;
          const url = item.product_link || item.link || `https://www.google.com/search?q=${encodeURIComponent(title)}&tbm=shop`;
          const demandScore = demandFromReviews(rating, reviews);

          products.push({
            id: `google_shopping-${normalizeTitle(title)}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
            title, url, image: item.thumbnail || null, source: "google_shopping", supplier: item.source || "Multiple retailers",
            category,
            supplierCost: { value: null, quality: "unavailable", source: "google_shopping", collectedAt: now },
            retailPrice: { value: price, quality: "observed", source: "google_shopping", collectedAt: now },
            estimatedSellingPrice: price,
            estimatedProfit: null,
            estimatedMargin: null,
            shippingDays: { value: null, quality: "unavailable", source: "google_shopping", collectedAt: now },
            rating: { value: rating, quality: "observed", source: "google_shopping", collectedAt: now },
            reviewCount: { value: reviews, quality: "observed", source: "google_shopping", collectedAt: now },
            reviewGrowth: { value: null, quality: "unavailable", source: "google_shopping", collectedAt: now },
            searchTrend: { value: `${reviews.toLocaleString()} verified reviews at ${item.source || "retail"}`, quality: "observed", source: "google_shopping", collectedAt: now },
            socialEngagement: { value: null, quality: "unavailable", source: "google_shopping", collectedAt: now },
            adActivity: { value: null, quality: "unavailable", source: "google_shopping", collectedAt: now },
            competitionLevel,
            competingSellers: { value: results.length, quality: "observed", source: "google_shopping", collectedAt: now },
            firstDetected: now,
            lastDetected: now,
            seasonalRelevance: category === "Seasonal" ? "seasonal" : "evergreen",
            targetAudience: inferAudience(category),
            problemSolved: inferProblem(category),
            ...inferTraits(title, category),
            impulseFriendly: price <= 35,
            isMock: false,
            scoringInputs: { demandTrendScore: demandScore, socialMomentumScore: Math.round(demandScore * 0.7), ratingScore: Math.round(((rating - 3) / 2) * 100), supplierReliabilityScore: 60 },
            evidenceSeed: [
              { label: "Google Shopping — validated retail listing", detail: `Real listing at ${item.source || "a major retailer"}: $${price.toFixed(2)}, ${rating}★ rating, ${reviews.toLocaleString()} reviews — this exact product type is already selling.`, source: "google_shopping", quality: "observed", timestamp: now },
              { label: "No supplier cost", detail: "This is a retail comparable, not a supplier listing — connect CJdropshipping or a supplier feed to find a wholesale source for a similar product.", source: "google_shopping", quality: "unavailable", timestamp: now }
            ],
            confidenceHint: "high",
            matchKeys: { canonicalUrl: canonicalizeUrl(url), normalizedTitle: normalizeTitle(title), supplierProductId: null, upc: null, sku: null, asin: null }
          });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Failed to search "${keyword}".`);
      }
    }

    return { source: "google_shopping", products, isMock: false, error: errors.length ? errors.join(" ") : null, requestsUsed };
  }
};
