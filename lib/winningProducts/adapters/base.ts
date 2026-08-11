import { AdapterResult, AdapterSearchParams, SourceAdapter, SourceId } from "../types";
import { generateMockProducts } from "./mockData";

// Maps each source to the env var that would hold its API key/credentials in production.
// isConnected() only ever returns true once that var is actually set — nothing here
// pretends a live integration exists until real fetch logic is wired up and a key is present.
export const ENV_KEY_BY_SOURCE: Partial<Record<SourceId, string>> = {
  google_shopping: "GOOGLE_SHOPPING_API_KEY",
  amazon: "AMAZON_PAAPI_ACCESS_KEY",
  cjdropshipping: "CJ_API_KEY",
  aliexpress: "ALIEXPRESS_AFFILIATE_KEY",
  shopify_supplier_feed: "SUPPLIER_FEED_URL",
  mavely: "MAVELY_API_KEY",
  pinterest: "PINTEREST_ACCESS_TOKEN",
  tiktok: "TIKTOK_CREATIVE_CENTER_KEY",
  youtube: "YOUTUBE_API_KEY",
  etsy: "ETSY_API_KEY"
};

export function makeMockAdapter(id: SourceId, label: string): SourceAdapter {
  return {
    id,
    label,
    isConnected() {
      const envKey = ENV_KEY_BY_SOURCE[id];
      return envKey ? Boolean(process.env[envKey]) : false;
    },
    async run(params: AdapterSearchParams): Promise<AdapterResult> {
      if (this.isConnected()) {
        // A real integration would call the live API here using the configured key.
        // That fetch logic isn't implemented yet, so we fail loudly instead of
        // silently returning mock data under a "connected" label.
        return { source: id, products: [], isMock: false, error: `${label} is connected but live fetch logic isn't implemented yet in adapters/${id}.ts.`, requestsUsed: 0 };
      }
      const products = generateMockProducts(id, params.categories, Math.min(params.limit, 6));
      return { source: id, products, isMock: true, error: null, requestsUsed: 0 };
    }
  };
}
