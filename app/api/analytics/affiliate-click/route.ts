import { NextResponse } from "next/server";
import { z } from "zod";
import { formatApiError } from "@/lib/apiError";

// No analytics database exists in this app (see docs/affiliate-products.md) — this route
// logs to Vercel's function logs, matching how the rest of this codebase treats
// "not worth a real backend yet" telemetry. Swap the console.log below for a real analytics
// provider (Segment, PostHog, a Supabase table, etc.) later without changing the theme-side
// contract — the request shape is intentionally provider-agnostic.
const schema = z.object({
  productId: z.string().min(1),
  productTitle: z.string().default(""),
  merchant: z.string().default(""),
  affiliateNetwork: z.string().default(""),
  destinationUrl: z.string().url(),
  timestamp: z.string().default(() => new Date().toISOString())
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const event = schema.parse(body);
    // Structured single-line log — easy to grep/alert on in Vercel logs.
    console.log("[affiliate_product_click]", JSON.stringify(event));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Invalid click event") }, { status: 400 });
  }
}
