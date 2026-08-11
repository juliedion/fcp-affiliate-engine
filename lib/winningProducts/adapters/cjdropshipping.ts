import { canonicalizeUrl, normalizeTitle } from "../dedupe";
import { AdapterResult, AdapterSearchParams, CompetitionLevel, RawProductOpportunity, SourceAdapter } from "../types";
import { generateMockProducts, resolveQueries } from "./mockData";
import { fetchTrendScore } from "./googleTrends";
import { inferAudience, inferProblem, inferTraits } from "../inference";

const AUTH_URL = "https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken";
const SEARCH_URL = "https://developers.cjdropshipping.com/api2.0/v1/product/list";
// CJ's own quota is generous (just a 1 req/sec throttle we respect below), so we can
// afford to cover most/all categories in one scan — unlike Trends, this isn't metered.
const MAX_QUERIES_PER_SCAN = 8;
const MAX_PER_CATEGORY = 8;
// Enrich only the highest-margin CJ candidates with a real Trends lookup on their own
// title, so at least the best few products end up with both real cost AND real demand
// data — capped to protect SerpApi's free-tier quota.
const MAX_TREND_ENRICHMENTS = 3;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Google Trends rejects queries over 100 characters — CJ's marketing-style titles
// routinely run 100-150+ chars, so trim to the first few words at a word boundary.
function shortenForTrends(title: string, maxLen = 80): string {
  if (title.length <= maxLen) return title;
  const truncated = title.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim();
}

type CjTokenCache = { token: string; expiresAt: number };
let cachedToken: CjTokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const email = process.env.CJ_EMAIL;
  const apiKey = process.env.CJ_API_KEY;
  if (!email || !apiKey) throw new Error("CJ_EMAIL / CJ_API_KEY are not configured.");
  const r = await fetch(AUTH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: apiKey }) });
  const data = await r.json();
  if (!r.ok || !data?.data?.accessToken) throw new Error(data?.message || "Could not authenticate with CJdropshipping.");
  const token = data.data.accessToken as string;
  cachedToken = { token, expiresAt: Date.now() + 1000 * 60 * 60 * 12 }; // re-check daily even though CJ's token lasts much longer
  return token;
}

type CjProduct = {
  pid: string; productNameEn: string; productSku: string; productImage: string; sellPrice: string;
  supplierName: string; listingCount: number; shippingCountryCodes: string[]; categoryName: string;
};

async function searchProducts(keyword: string, token: string, pageSize: number): Promise<CjProduct[]> {
  const url = `${SEARCH_URL}?pageNum=1&pageSize=${pageSize}&productName=${encodeURIComponent(keyword)}`;
  const r = await fetch(url, { headers: { "CJ-Access-Token": token } });
  const data = await r.json();
  if (!r.ok || !data?.result) throw new Error(data?.message || `CJdropshipping search failed for "${keyword}".`);
  return (data.data?.list ?? []) as CjProduct[];
}

export const cjdropshippingAdapter: SourceAdapter = {
  id: "cjdropshipping",
  label: "CJdropshipping",
  isConnected() {
    return Boolean(process.env.CJ_EMAIL && process.env.CJ_API_KEY);
  },
  async run(params: AdapterSearchParams): Promise<AdapterResult> {
    if (!this.isConnected()) {
      const products = generateMockProducts("cjdropshipping", params.categories, Math.min(params.limit, 6));
      return { source: "cjdropshipping", products, isMock: true, error: null, requestsUsed: 0 };
    }

    const queries = resolveQueries(params.categories, params.keyword, MAX_QUERIES_PER_SCAN);
    const perQueryLimit = Math.max(3, Math.min(MAX_PER_CATEGORY, Math.ceil(params.limit / Math.max(1, queries.length))));

    let requestsUsed = 0;
    const errors: string[] = [];
    const products: RawProductOpportunity[] = [];

    let token: string;
    try {
      token = await getAccessToken();
      requestsUsed++;
    } catch (e) {
      return { source: "cjdropshipping", products: [], isMock: false, error: e instanceof Error ? e.message : "Authentication failed.", requestsUsed };
    }

    for (const { category, keyword } of queries) {
      requestsUsed++;
      await sleep(1100); // CJ's API allows only 1 request/second
      try {
        const list = await searchProducts(keyword, token, perQueryLimit);
        const now = new Date().toISOString();
        for (const item of list) {
          const cost = Number(item.sellPrice);
          if (!cost || cost <= 0) continue;
          const suggestedRetail = Math.round((cost / (1 - 0.6)) * 100) / 100;
          const hasUsWarehouse = item.shippingCountryCodes?.some(c => c.includes("US")) ?? false;
          const shippingDays = hasUsWarehouse ? 8 : 16;
          const competitionLevel: CompetitionLevel = item.listingCount === 0 ? "low" : item.listingCount <= 5 ? "medium" : "high";
          const title = item.productNameEn || "Untitled CJ product";
          const url = `https://cjdropshipping.com/product-detail.html?pid=${item.pid}`;

          products.push({
            id: `cjdropshipping-${item.pid}`,
            title, url, image: item.productImage || null, source: "cjdropshipping", supplier: item.supplierName || "CJdropshipping supplier",
            category,
            supplierCost: { value: cost, quality: "observed", source: "cjdropshipping", collectedAt: now },
            retailPrice: { value: null, quality: "unavailable", source: "cjdropshipping", collectedAt: now },
            estimatedSellingPrice: suggestedRetail,
            estimatedProfit: Math.round((suggestedRetail - cost) * 100) / 100,
            estimatedMargin: 60,
            shippingDays: { value: shippingDays, quality: "ai_estimated", source: "cjdropshipping", collectedAt: now },
            rating: { value: null, quality: "unavailable", source: "cjdropshipping", collectedAt: now },
            reviewCount: { value: null, quality: "unavailable", source: "cjdropshipping", collectedAt: now },
            reviewGrowth: { value: null, quality: "unavailable", source: "cjdropshipping", collectedAt: now },
            searchTrend: { value: null, quality: "unavailable", source: "cjdropshipping", collectedAt: now },
            socialEngagement: { value: null, quality: "unavailable", source: "cjdropshipping", collectedAt: now },
            adActivity: { value: null, quality: "unavailable", source: "cjdropshipping", collectedAt: now },
            competitionLevel,
            competingSellers: { value: item.listingCount ?? null, quality: item.listingCount !== undefined ? "observed" : "unavailable", source: "cjdropshipping", collectedAt: now },
            firstDetected: now,
            lastDetected: now,
            seasonalRelevance: category === "Seasonal" ? "seasonal" : "evergreen",
            targetAudience: inferAudience(category),
            problemSolved: inferProblem(category),
            ...inferTraits(title, category),
            impulseFriendly: suggestedRetail <= 35,
            isMock: false,
            scoringInputs: { demandTrendScore: 40, socialMomentumScore: 30, ratingScore: 40, supplierReliabilityScore: 55 },
            evidenceSeed: [
              { label: "CJdropshipping catalog", detail: `Real supplier cost ($${cost.toFixed(2)}) and listing data pulled directly from CJdropshipping's product catalog.`, source: "cjdropshipping", quality: "observed", timestamp: now },
              { label: "Demand & social signal", detail: "CJdropshipping doesn't provide search-demand or social data — connect Google Trends or a social source to fill that in for this product.", source: "cjdropshipping", quality: "unavailable", timestamp: now }
            ],
            confidenceHint: "medium",
            matchKeys: { canonicalUrl: canonicalizeUrl(url), normalizedTitle: normalizeTitle(title), supplierProductId: item.pid, upc: null, sku: item.productSku || null, asin: null }
          });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Failed to search "${keyword}".`);
      }
    }

    const serpApiKey = process.env.SERPAPI_KEY;
    if (serpApiKey && products.length > 0) {
      const topCandidates = [...products].sort((a, b) => (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0)).slice(0, MAX_TREND_ENRICHMENTS);
      for (const product of topCandidates) {
        const trendQuery = shortenForTrends(product.title);
        try {
          await sleep(300);
          const trend = await fetchTrendScore(trendQuery, serpApiKey);
          if (!trend) continue;
          const now = new Date().toISOString();
          product.searchTrend = { value: `${trend.label} (avg interest ${trend.avg}/100)`, quality: "observed", source: "google_trends", collectedAt: now };
          product.scoringInputs.demandTrendScore = trend.score;
          product.scoringInputs.socialMomentumScore = Math.round(trend.score * 0.6);
          product.evidenceSeed = product.evidenceSeed.filter(e => e.label !== "Demand & social signal");
          product.evidenceSeed.push({ label: "Google Trends demand signal (cross-referenced)", detail: `Real search-interest trend for "${trendQuery}" via SerpApi — ${trend.label.toLowerCase()}, average interest ${trend.avg}/100.`, source: "google_trends", quality: "observed", timestamp: now });
        } catch {
          // Enrichment is best-effort — a failed lookup just leaves the product without demand data, not an error for the whole scan.
        }
      }
    }

    return { source: "cjdropshipping", products, isMock: false, error: errors.length ? errors.join(" ") : null, requestsUsed };
  }
};
