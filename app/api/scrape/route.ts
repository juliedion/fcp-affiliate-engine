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
    url?: string | null;
    image?: { url?: string | null } | null;
  };
};

function isAmazonUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "amzn.to" || host.endsWith(".amzn.to") || host === "amazon.com" || host.endsWith(".amazon.com");
  } catch { return false; }
}

function isAmazonGenericImage(value: string): boolean {
  return /amazonfresh|fresh-logo|amazon_logo|amazon-logo|nav-logo|logo\.png|logo\.jpg/i.test(value);
}

async function resolveDestinationUrl(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)amzn\.to$/i.test(parsed.hostname)) return url;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
        headers: { "user-agent": "Mozilla/5.0 (compatible; FortCrazypantsFindEngine/1.0)", accept: "text/html,application/xhtml+xml" }
      });
      return response.url || url;
    } finally { clearTimeout(timeout); }
  } catch { return url; }
}

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
        destinationUrl: payload.data?.url || null,
        images: image && /^https?:\/\//i.test(image) ? [image] : []
      };
    } finally { clearTimeout(timeout); }
  } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const { url } = schema.parse(await req.json());
    let researchUrl = await resolveDestinationUrl(url);
    let scraped = await scrapeProduct(researchUrl);
    let browserFallbackUsed = false;

    scraped = { ...scraped, title: usableProductTitle(scraped.title) };

    if (scraped.blocked || scraped.images.length === 0 || !usableProductTitle(scraped.title)) {
      let fallback = await browserMetadataFallback(researchUrl);
      if ((!fallback?.title || researchUrl === url) && /(^|\.)amzn\.to$/i.test(new URL(url).hostname)) {
        const shortFallback = await browserMetadataFallback(url);
        const destination = shortFallback?.destinationUrl;
        if (destination && /^https?:\/\//i.test(destination) && destination !== url) {
          researchUrl = destination;
          // IMPORTANT: scrape the resolved Amazon product page itself. This can recover the
          // real <title>, price, gallery and About-this-item data even when social metadata
          // from Microlink is only the generic Amazon/Amazon Fresh preview.
          const resolvedScrape = await scrapeProduct(destination);
          if (usableProductTitle(resolvedScrape.title) || resolvedScrape.images.length || resolvedScrape.price) {
            scraped = {
              ...scraped,
              title: usableProductTitle(resolvedScrape.title) || scraped.title,
              price: resolvedScrape.price || scraped.price,
              description: resolvedScrape.description || scraped.description,
              images: resolvedScrape.images.length ? resolvedScrape.images : scraped.images,
              blocked: resolvedScrape.blocked
            };
          }
          const destinationFallback = await browserMetadataFallback(destination);
          fallback = destinationFallback?.title ? destinationFallback : (shortFallback || fallback);
        } else if (shortFallback) fallback = shortFallback;
      }

      if (fallback) {
        const fallbackImages = isAmazonUrl(researchUrl)
          ? fallback.images.filter(image => !isAmazonGenericImage(image))
          : fallback.images;
        browserFallbackUsed = fallbackImages.length > 0 || Boolean(fallback.title);
        scraped = {
          ...scraped,
          title: usableProductTitle(scraped.title) || fallback.title || null,
          description: scraped.description || fallback.description || null,
          // Never replace an Amazon product gallery with Amazon Fresh/site-brand artwork.
          images: scraped.images.length ? scraped.images : fallbackImages
        };
      }
    }

    if (!usableProductTitle(scraped.title)) {
      const resolvedTitle = usableProductTitle(titleFromProductUrl(researchUrl));
      const originalTitle = usableProductTitle(titleFromProductUrl(url));
      scraped = { ...scraped, title: resolvedTitle || originalTitle };
    }

    const inference = inferProductInput(scraped, url);
    const research = buildResearchSummary(scraped, inference);
    return NextResponse.json({
      scraped, research, ...inference,
      resolvedResearchUrl: researchUrl !== url ? researchUrl : undefined,
      fallbackUsed: Boolean(scraped.blocked || browserFallbackUsed),
      browserFallbackUsed,
      fallbackReason: scraped.blocked
        ? browserFallbackUsed
          ? "Retailer blocked direct research; product metadata recovered with the browser fallback. Verify the details before generating."
          : "Retailer blocked automatic product research. Verify product name, price, and image before generating."
        : null
    });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Could not read that URL") }, { status: 400 });
  }
}
