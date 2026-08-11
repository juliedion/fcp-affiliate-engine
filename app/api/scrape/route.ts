import { NextResponse } from "next/server";
import { z } from "zod";
import { buildResearchSummary, inferProductInput, scrapeProduct } from "@/lib/scrape";
import { formatApiError } from "@/lib/apiError";

const schema = z.object({ url: z.string().url() });

export async function POST(req: Request) {
  try {
    const { url } = schema.parse(await req.json());
    const scraped = await scrapeProduct(url);
    const inference = inferProductInput(scraped, url);
    const research = buildResearchSummary(scraped, inference);
    return NextResponse.json({ scraped, research, ...inference });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Could not read that URL") }, { status: 400 });
  }
}
