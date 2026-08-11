import { canonicalizeUrl, normalizeTitle } from "../dedupe";
import { AdapterResult, AdapterSearchParams, RawProductOpportunity, SourceAdapter } from "../types";
import { generateMockProducts, resolveQueries } from "./mockData";
import { inferAudience, inferProblem, inferTraits } from "../inference";

// Real integration via SerpApi's licensed Google Trends engine (serpapi.com) — Google
// itself has no official Trends API, so this is the compliant way to get that data
// without scraping Google's undocumented endpoints. Capped to a handful of calls per
// scan to stay inside SerpApi's free tier (100 searches/month).
const MAX_QUERIES_PER_SCAN = 4;

export async function fetchTrendScore(keyword: string, apiKey: string): Promise<{ score: number; label: string; avg: number } | null> {
  const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(keyword)}&data_type=TIMESERIES&geo=US&api_key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  const timeline: { values?: { extracted_value?: number }[] }[] = data?.interest_over_time?.timeline_data;
  if (!timeline || timeline.length === 0) return null;

  const values = timeline.map(t => t.values?.[0]?.extracted_value ?? 0);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(values.length / 2);
  const firstHalfAvg = values.slice(0, mid).reduce((a, b) => a + b, 0) / (mid || 1);
  const secondHalfAvg = values.slice(mid).reduce((a, b) => a + b, 0) / ((values.length - mid) || 1);
  const momentum = secondHalfAvg - firstHalfAvg;

  const score = Math.round(Math.min(100, Math.max(0, avg * 0.6 + Math.max(0, momentum) * 3)));
  const label = momentum > 8 ? "Rising" : momentum < -8 ? "Softening" : "Steady";
  return { score, label, avg: Math.round(avg) };
}

export const googleTrendsAdapter: SourceAdapter = {
  id: "google_trends",
  label: "Google Trends (via SerpApi)",
  isConnected() {
    return Boolean(process.env.SERPAPI_KEY);
  },
  async run(params: AdapterSearchParams): Promise<AdapterResult> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      const products = generateMockProducts("google_trends", params.categories, Math.min(params.limit, 6));
      return { source: "google_trends", products, isMock: true, error: null, requestsUsed: 0 };
    }

    const queries = resolveQueries(params.categories, params.keyword, MAX_QUERIES_PER_SCAN);

    const products: RawProductOpportunity[] = [];
    let requestsUsed = 0;
    const errors: string[] = [];

    for (const { category, keyword } of queries) {
      requestsUsed++;
      try {
        const trend = await fetchTrendScore(keyword, apiKey);
        if (!trend) { errors.push(`No trend data returned for "${keyword}".`); continue; }
        const now = new Date().toISOString();
        const url = `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}&geo=US`;
        products.push({
          id: `google_trends-${normalizeTitle(keyword)}-${Date.now()}`,
          title: keyword,
          url,
          image: null,
          source: "google_trends",
          supplier: null,
          category,
          supplierCost: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          retailPrice: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          estimatedSellingPrice: null,
          estimatedProfit: null,
          estimatedMargin: null,
          shippingDays: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          rating: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          reviewCount: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          reviewGrowth: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          searchTrend: { value: `${trend.label} (avg interest ${trend.avg}/100)`, quality: "observed", source: "google_trends", collectedAt: now },
          socialEngagement: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          adActivity: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          competitionLevel: "medium",
          competingSellers: { value: null, quality: "unavailable", source: "google_trends", collectedAt: now },
          firstDetected: now,
          lastDetected: now,
          seasonalRelevance: "evergreen",
          targetAudience: inferAudience(category),
          problemSolved: inferProblem(category),
          ...inferTraits(keyword, category),
          impulseFriendly: false,
          isMock: false,
          scoringInputs: {
            demandTrendScore: trend.score,
            socialMomentumScore: Math.round(trend.score * 0.6),
            ratingScore: 40,
            supplierReliabilityScore: 40
          },
          evidenceSeed: [
            { label: "Google Trends demand signal", detail: `Real search-interest trend for "${keyword}" via SerpApi — ${trend.label.toLowerCase()}, average interest ${trend.avg}/100.`, source: "google_trends", quality: "observed", timestamp: now },
            { label: "Everything else on this card", detail: "Price, cost, rating, competition, and other fields are not observable from Google Trends alone — connect Google Shopping, Amazon, or a supplier feed to fill them in. Shown values for those fields are neutral placeholders, not real data.", source: "google_trends", quality: "unavailable", timestamp: now }
          ],
          confidenceHint: "medium",
          matchKeys: { canonicalUrl: canonicalizeUrl(url), normalizedTitle: normalizeTitle(keyword), supplierProductId: null, upc: null, sku: null, asin: null }
        });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Failed to fetch trend data for "${keyword}".`);
      }
    }

    return { source: "google_trends", products, isMock: false, error: errors.length ? errors.join(" ") : null, requestsUsed };
  }
};
