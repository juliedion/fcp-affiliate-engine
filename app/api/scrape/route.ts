import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildResearchSummary,
  inferProductInput,
  scrapeProduct
} from "@/lib/scrape";
import { formatApiError } from "@/lib/apiError";

const schema = z.object({ url: z.string().url() });

const GENERIC_RETAILER_TITLES = new Set([
  "amazon", "amazon.com", "walmart", "walmart.com", "target", "target.com",
  "etsy", "ebay", "qvc", "qvc.com", "dick's sporting goods", "dicks sporting goods"
]);

function usableProductTitle(value: string | null | undefined): string | null {
  const title = value?.trim();
  if (!title || GENERIC_RETAILER_TITLES.has(title.toLowerCase())) return null;
  return title;
}

function titleFromProductUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const ignoredSegments = new Set(["p", "product", "products", "dp", "gp"]);
    const segments = parsed.pathname.split("/").map(s => s.trim()).filter(Boolean).filter(s => !ignoredSegments.has(s.toLowerCase()));
    const candidates = segments.map(s => decodeURIComponent(s)).filter(segment => {
      const letters = (segment.match(/[a-z]/gi) || []).length;
      const separators = (segment.match(/[-_]/g) || []).length;
      return letters >= 8 && separators >= 1;
    }).sort((a, b) => b.length - a.length);
    const slug = candidates[0];
    if (!slug) return "";
    return slug.replace(/[-_]+/g, " ").replace(/\b\d{8,}\b/g, "").replace(/\s+/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+[A-Z0-9]{15,}$/i, "").trim();
  } catch { return ""; }
}

type MicrolinkData = {
  status?: string;
  data?: {
    title?: string | null;
    description?: string | null;
    image?: { url?: string | null } | null;
    logo?: { url?: string | null } | null;
  };
};

async function browserMetadataFallback(url: string) {
  try {
    const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(url)}&meta=true&screenshot=false&video=false&audio=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) return null;
      const payload = await response.json() as MicrolinkData;
      const image = payload.data?.image?.url;
      return {
        title: usableProductTitle(payload.data?.title),
        description: payload.data?.description || null,
        images: image && /^https?:\/\//i.test(image) ? [image] : []
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const { url } = schema.parse(await req.json());
    let scraped = await scrapeProduct(url);
    let browserFallbackUsed = false;

    // Never allow a retailer/site name (for example Amazon) to become the Shopify
    // product title. Amazon frequently returns generic social metadata even when
    // the gallery and price are usable.
    scraped = { ...scraped, title: usableProductTitle(scraped.title) };

    if (scraped.blocked || scraped.images.length === 0) {
      const fallback = await browserMetadataFallback(url);
      if (fallback) {
        browserFallbackUsed = fallback.images.length > 0;
        scraped = {
          ...scraped,
          title: usableProductTitle(scraped.title) || fallback.title || null,
          description: scraped.description || fallback.description || null,
          images: scraped.images.length ? scraped.images : fallback.images
        };
      }
    }

    // URL-derived titles are useful for descriptive retailer slugs, but Amazon's
    // short /dp/ASIN links contain no product name. In that case leave the title
    // empty instead of silently publishing a product named "Amazon".
    if (!usableProductTitle(scraped.title)) {
      const fallbackTitle = usableProductTitle(titleFromProductUrl(url));
      scraped = { ...scraped, title: fallbackTitle };
    }

    const inference = inferProductInput(scraped, url);
    const research = buildResearchSummary(scraped, inference);

    return NextResponse.json({
      scraped,
      research,
      ...inference,
      fallbackUsed: Boolean(scraped.blocked || browserFallbackUsed),
      browserFallbackUsed,
      fallbackReason: scraped.blocked
        ? browserFallbackUsed
          ? "Retailer blocked direct research; product image/metadata recovered with the browser fallback. Verify product name and price before generating."
          : "Retailer blocked automatic product research. Verify product name, price, and image before generating."
        : null
    });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Could not read that URL") }, { status: 400 });
  }
}
