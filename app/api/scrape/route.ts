import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildResearchSummary,
  inferProductInput,
  scrapeProduct
} from "@/lib/scrape";
import { formatApiError } from "@/lib/apiError";

const schema = z.object({
  url: z.string().url()
});

function titleFromProductUrl(url: string): string {
  try {
    const parsed = new URL(url);

    const ignoredSegments = new Set([
      "p",
      "product",
      "products",
      "dp",
      "gp"
    ]);

    const segments = parsed.pathname
      .split("/")
      .map(segment => segment.trim())
      .filter(Boolean)
      .filter(segment => !ignoredSegments.has(segment.toLowerCase()));

    if (!segments.length) return "";

    // Prefer the longest human-readable URL segment.
    // Retailer product IDs tend to be short or mostly numeric/alphanumeric.
    const candidates = segments
      .map(segment => decodeURIComponent(segment))
      .filter(segment => {
        const letters = (segment.match(/[a-z]/gi) || []).length;
        const separators = (segment.match(/[-_]/g) || []).length;

        return letters >= 8 && separators >= 1;
      })
      .sort((a, b) => b.length - a.length);

    const slug = candidates[0];
    if (!slug) return "";

    let title = slug
      .replace(/[-_]+/g, " ")
      .replace(/\b\d{8,}\b/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, char => char.toUpperCase());

    // Remove common retailer SKU-like suffixes if they leak into the slug.
    title = title
      .replace(/\s+[A-Z0-9]{15,}$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return title;
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const { url } = schema.parse(await req.json());

    let scraped = await scrapeProduct(url);

    /*
     * Retailers such as DICK'S can serve Vercel a maintenance/bot-protection
     * page even though the real product works normally in a browser.
     *
     * In that situation, do NOT fabricate price, description, or images.
     * Recover only the product name from the URL so the user can enter the
     * missing price/photo and continue through Make It Crazypants.
     */
    if (scraped.blocked || !scraped.title) {
      const fallbackTitle = titleFromProductUrl(url);

      scraped = {
        ...scraped,
        title: scraped.title || fallbackTitle || null
      };
    }

    const inference = inferProductInput(scraped, url);
    const research = buildResearchSummary(scraped, inference);

    return NextResponse.json({
      scraped,
      research,
      ...inference,
      fallbackUsed: Boolean(scraped.blocked),
      fallbackReason: scraped.blocked
        ? "Retailer blocked automatic product research. Product name was recovered from the URL when possible; verify price and image before generating."
        : null
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: formatApiError(error, "Could not read that URL")
      },
      { status: 400 }
    );
  }
}
