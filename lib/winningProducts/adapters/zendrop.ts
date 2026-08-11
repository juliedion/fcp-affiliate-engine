import { canonicalizeUrl, normalizeTitle } from "../dedupe";
import { AdapterResult, AdapterSearchParams, RawProductOpportunity, SourceAdapter } from "../types";
import { generateMockProducts, resolveQueries } from "./mockData";
import { fetchTrendScore } from "./googleTrends";
import { inferAudience, inferProblem, inferTraits } from "../inference";

// Real integration via Zendrop's MCP endpoint (app.zendrop.com/mcp/v1), which is genuine
// Model Context Protocol over JSON-RPC 2.0. The catalog search tool is `get_catalog_products`
// (confirmed via tools/list against the live account) — it takes a free-text `keyword`,
// not a category name, and returns only { id, name, description, image, price } per
// product (no shipping/rating/listing-count data — those live behind separate tools we
// don't call here to keep this to one request per category per scan).
const MCP_URL = "https://app.zendrop.com/mcp/v1";
const CATALOG_SEARCH_TOOL = "get_catalog_products";
const MAX_QUERIES_PER_SCAN = 4;
const MAX_PER_CATEGORY = 8;
const MAX_TREND_ENRICHMENTS = 3;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type ZendropProduct = {
  id: number | string;
  name: string;
  description?: string | null;
  image?: string | null;
  price: string | number;
};

type McpToolResult = { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: { products?: ZendropProduct[] } };

async function rpcCall(apiKey: string, method: string, params: unknown): Promise<unknown> {
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const data = await r.json();
  if (!r.ok || data?.error) {
    const raw = data?.error;
    const message = typeof raw === "string" ? raw : raw?.message || JSON.stringify(raw) || `HTTP ${r.status}`;
    throw new Error(`Zendrop MCP "${method}" failed: ${message}`);
  }
  return data.result;
}

async function searchCatalog(keyword: string, apiKey: string, limit: number): Promise<ZendropProduct[]> {
  const result = (await rpcCall(apiKey, "tools/call", {
    name: CATALOG_SEARCH_TOOL,
    arguments: { keyword, limit: Math.min(60, limit) }
  })) as McpToolResult;
  if (result?.isError) throw new Error(`Zendrop tool "${CATALOG_SEARCH_TOOL}" returned an error: ${JSON.stringify(result.content).slice(0, 300)}`);
  if (Array.isArray(result?.structuredContent?.products)) return result.structuredContent.products;

  const textBlock = result?.content?.find(c => c.type === "text" && c.text);
  if (textBlock?.text) {
    try {
      const parsed = JSON.parse(textBlock.text);
      if (Array.isArray(parsed?.products)) return parsed.products;
    } catch {
      throw new Error(`Zendrop tool "${CATALOG_SEARCH_TOOL}" returned non-JSON text: ${textBlock.text.slice(0, 200)}`);
    }
  }
  throw new Error(`Zendrop tool "${CATALOG_SEARCH_TOOL}" returned an unrecognized response shape: ${JSON.stringify(result).slice(0, 300)}`);
}

export const zendropAdapter: SourceAdapter = {
  id: "zendrop",
  label: "Zendrop",
  isConnected() {
    return Boolean(process.env.ZENDROP_API_KEY);
  },
  async run(params: AdapterSearchParams): Promise<AdapterResult> {
    const apiKey = process.env.ZENDROP_API_KEY;
    if (!apiKey) {
      const products = generateMockProducts("zendrop", params.categories, Math.min(params.limit, 6));
      return { source: "zendrop", products, isMock: true, error: null, requestsUsed: 0 };
    }

    const queries = resolveQueries(params.categories, params.keyword, MAX_QUERIES_PER_SCAN);
    const perQueryLimit = Math.max(3, Math.min(MAX_PER_CATEGORY, Math.ceil(params.limit / Math.max(1, queries.length))));

    let requestsUsed = 0;
    const errors: string[] = [];
    const products: RawProductOpportunity[] = [];

    for (const { category, keyword } of queries) {
      requestsUsed++;
      try {
        const list = await searchCatalog(keyword, apiKey, perQueryLimit);
        const now = new Date().toISOString();
        for (const item of list) {
          const cost = Number(item.price);
          if (!cost || cost <= 0) continue;
          const suggestedRetail = Math.round((cost / (1 - 0.6)) * 100) / 100;
          const title = item.name || "Untitled Zendrop product";
          const url = `https://app.zendrop.com/product/${item.id}`;

          products.push({
            id: `zendrop-${item.id}`,
            title, url, image: item.image || null, source: "zendrop", supplier: "Zendrop supplier",
            category,
            supplierCost: { value: cost, quality: "observed", source: "zendrop", collectedAt: now },
            retailPrice: { value: null, quality: "unavailable", source: "zendrop", collectedAt: now },
            estimatedSellingPrice: suggestedRetail,
            estimatedProfit: Math.round((suggestedRetail - cost) * 100) / 100,
            estimatedMargin: 60,
            // Real per-destination shipping estimates require a separate get_catalog_shipping_estimate
            // call per product — not made here to keep this to one request per category per scan.
            shippingDays: { value: 12, quality: "ai_estimated", source: "zendrop", collectedAt: now },
            rating: { value: null, quality: "unavailable", source: "zendrop", collectedAt: now },
            reviewCount: { value: null, quality: "unavailable", source: "zendrop", collectedAt: now },
            reviewGrowth: { value: null, quality: "unavailable", source: "zendrop", collectedAt: now },
            searchTrend: { value: null, quality: "unavailable", source: "zendrop", collectedAt: now },
            socialEngagement: { value: null, quality: "unavailable", source: "zendrop", collectedAt: now },
            adActivity: { value: null, quality: "unavailable", source: "zendrop", collectedAt: now },
            competitionLevel: "medium",
            competingSellers: { value: null, quality: "unavailable", source: "zendrop", collectedAt: now },
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
              { label: "Zendrop catalog", detail: `Real supplier cost ($${cost.toFixed(2)}) pulled directly from Zendrop's product catalog via keyword "${keyword}".`, source: "zendrop", quality: "observed", timestamp: now },
              { label: "Demand, rating, and competition signal", detail: "Zendrop's search tool doesn't return rating, review, listing-count, or demand data — connect Google Trends/Shopping or a social source to fill that in for this product.", source: "zendrop", quality: "unavailable", timestamp: now }
            ],
            confidenceHint: "medium",
            matchKeys: { canonicalUrl: canonicalizeUrl(url), normalizedTitle: normalizeTitle(title), supplierProductId: String(item.id), upc: null, sku: null, asin: null }
          });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Failed to search category "${category}".`);
      }
    }

    const serpApiKey = process.env.SERPAPI_KEY;
    if (serpApiKey && products.length > 0) {
      const topCandidates = [...products].sort((a, b) => (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0)).slice(0, MAX_TREND_ENRICHMENTS);
      for (const product of topCandidates) {
        try {
          await sleep(300);
          const trend = await fetchTrendScore(product.title, serpApiKey);
          if (!trend) continue;
          const now = new Date().toISOString();
          product.searchTrend = { value: `${trend.label} (avg interest ${trend.avg}/100)`, quality: "observed", source: "google_trends", collectedAt: now };
          product.scoringInputs.demandTrendScore = trend.score;
          product.scoringInputs.socialMomentumScore = Math.round(trend.score * 0.6);
          product.evidenceSeed = product.evidenceSeed.filter(e => e.label !== "Demand, rating, and competition signal");
          product.evidenceSeed.push({ label: "Google Trends demand signal (cross-referenced)", detail: `Real search-interest trend for "${product.title}" via SerpApi — ${trend.label.toLowerCase()}, average interest ${trend.avg}/100.`, source: "google_trends", quality: "observed", timestamp: now });
        } catch {
          // Enrichment is best-effort — a failed lookup just leaves the product without demand data, not an error for the whole scan.
        }
      }
    }

    return { source: "zendrop", products, isMock: false, error: errors.length ? errors.join(" ") : null, requestsUsed };
  }
};
