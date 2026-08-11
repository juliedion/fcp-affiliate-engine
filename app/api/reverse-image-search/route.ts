import { NextResponse } from "next/server";
import { z } from "zod";
import { formatApiError } from "@/lib/apiError";

// Real integration via SerpApi's Google Lens engine — Google itself has no official
// reverse-image-search API, so this is the same licensed-provider approach already used
// for Trends/Shopping/Amazon. Google Lens requires a publicly accessible image URL (no
// direct file-upload endpoint), so this only works with a hosted image, not a raw upload
// from the user's device.
const schema = z.object({ imageUrl: z.string().url() });

type LensMatch = {
  title?: string;
  link?: string;
  source?: string;
  thumbnail?: string;
  price?: { value?: string; extracted_value?: number };
};

export async function POST(req: Request) {
  try {
    const { imageUrl } = schema.parse(await req.json());
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) return NextResponse.json({ error: "SERPAPI_KEY is not configured on the server." }, { status: 400 });

    const url = `https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(imageUrl)}&api_key=${apiKey}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok || data?.error) throw new Error(typeof data?.error === "string" ? data.error : `Reverse image search failed (HTTP ${r.status}).`);

    const matches = (data.visual_matches ?? []) as LensMatch[];
    const results = matches
      .filter(m => m.title && m.link)
      .slice(0, 20)
      .map(m => ({
        title: m.title!,
        link: m.link!,
        source: m.source || null,
        thumbnail: m.thumbnail || null,
        price: m.price?.extracted_value ?? null
      }));

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Reverse image search failed.") }, { status: 400 });
  }
}
