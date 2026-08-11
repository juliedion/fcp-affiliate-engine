import { SourceAdapter, SourceId } from "../types";
import { makeMockAdapter } from "./base";
import { googleTrendsAdapter } from "./googleTrends";
import { cjdropshippingAdapter } from "./cjdropshipping";
import { zendropAdapter } from "./zendrop";
import { creatorBlogsAdapter } from "./creatorBlogs";
import { googleShoppingAdapter } from "./googleShopping";
import { amazonAdapter } from "./amazon";

const LABELS: Record<Exclude<SourceId, "csv_upload">, string> = {
  google_trends: "Google Trends",
  google_shopping: "Google Shopping",
  amazon: "Amazon",
  cjdropshipping: "CJdropshipping",
  zendrop: "Zendrop",
  creator_blogs: "Creator Blogs",
  aliexpress: "AliExpress",
  shopify_supplier_feed: "Shopify Supplier Feed",
  mavely: "Mavely",
  pinterest: "Pinterest",
  tiktok: "TikTok Creative Center",
  meta_ad_library: "Meta Ad Library",
  reddit: "Reddit",
  youtube: "YouTube",
  etsy: "Etsy"
};

// csv_upload is handled separately (file-based, not a search-driven adapter) — see adapters/csv.ts.
export const SEARCH_ADAPTERS: Record<Exclude<SourceId, "csv_upload">, SourceAdapter> = {
  ...(Object.fromEntries(
    (Object.keys(LABELS) as Exclude<SourceId, "csv_upload">[]).map(id => [id, makeMockAdapter(id, LABELS[id])])
  ) as Record<Exclude<SourceId, "csv_upload">, SourceAdapter>),
  google_trends: googleTrendsAdapter,
  cjdropshipping: cjdropshippingAdapter,
  zendrop: zendropAdapter,
  creator_blogs: creatorBlogsAdapter,
  google_shopping: googleShoppingAdapter,
  amazon: amazonAdapter
};

export function getAdapter(id: SourceId): SourceAdapter | null {
  if (id === "csv_upload") return null;
  return SEARCH_ADAPTERS[id];
}
