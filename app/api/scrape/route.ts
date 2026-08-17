import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildResearchSummary,
  inferProductInput,
  scrapeProduct
} from "@/lib/scrape";
import { formatApiError } from "@/lib/apiError";

const schema = z.object({ url: z.string().url() });

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
        title: payload.data?.title || null,
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

    // If the retailer blocks our normal server fetch or simply exposes no image,
    // ask a browser-metadata service for the page's social/product image. This
    // keeps manual upload as a last resort without fabricating a product photo.
    if (scraped.blocked || scraped.images.length === 0) {
      const fallback = await browserMetadataFallback(url);
      if (fallback) {
        browserFallbackUsed = fallback.images.length > 0;
        scraped = {
          ...scraped,
          title: scraped.title || fallback.title || null,
          description: scraped.description || fallback.description || null,
          images: scraped.images.length ? scraped.images : fallback.images
        };
      }
    }

    if (scraped.blocked || !scraped.title) {
      const fallbackTitle = titleFromProductUrl(url);
      scraped = { ...scraped, title: scraped.title || fallbackTitle || null };
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
          ? "Retailer blocked direct research; product image/metadata recovered with the browser fallback. Verify price before generating."
          : "Retailer blocked automatic product research. Product name was recovered when possible; verify price and image before generating."
        : null
    });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Could not read that URL") }, { status: 400 });
  }
}
