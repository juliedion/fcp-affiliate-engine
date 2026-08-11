import { NextResponse } from "next/server";
import { z } from "zod";
import { SEARCH_ADAPTERS } from "@/lib/winningProducts/adapters";
import { scoreOpportunity } from "@/lib/winningProducts/scoring";
import { DEFAULT_WEIGHTS, FORT_CATEGORIES, ProductOpportunity, ScoreWeights, SourceId } from "@/lib/winningProducts/types";
import { formatApiError } from "@/lib/apiError";

const SEARCHABLE_SOURCE_IDS = Object.keys(SEARCH_ADAPTERS) as SourceId[];

const schema = z.object({
  categories: z.array(z.enum(FORT_CATEGORIES as [string, ...string[]])).default([]),
  sources: z.array(z.string()).default(SEARCHABLE_SOURCE_IDS),
  limit: z.coerce.number().min(1).max(50).default(6),
  weights: z.record(z.string(), z.number()).optional(),
  keyword: z.string().trim().min(1).optional()
});

// Server-side by design: this is where real API keys (Google Shopping, Amazon PA-API,
// CJdropshipping, etc.) would be read from process.env and used — never shipped to the client.
export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = schema.parse(await req.json());
    const sourceIds = body.sources.filter((s): s is SourceId => SEARCHABLE_SOURCE_IDS.includes(s as SourceId));
    const weights: ScoreWeights = { ...DEFAULT_WEIGHTS, ...(body.weights as Partial<ScoreWeights> | undefined) };

    const sourcesSearched: SourceId[] = [];
    const errors: { source: SourceId; message: string }[] = [];
    const results: ProductOpportunity[] = [];
    let productsChecked = 0;

    for (const id of sourceIds) {
      const adapter = SEARCH_ADAPTERS[id as Exclude<SourceId, "csv_upload">];
      if (!adapter) continue;
      sourcesSearched.push(id);
      try {
        const result = await adapter.run({ categories: body.categories as never, country: "US", limit: body.limit, keyword: body.keyword });
        if (result.error) errors.push({ source: id, message: result.error });
        productsChecked += result.products.length;
        for (const raw of result.products) results.push(scoreOpportunity(raw, weights));
      } catch (e) {
        errors.push({ source: id, message: e instanceof Error ? e.message : "Unknown adapter error" });
      }
    }

    return NextResponse.json({
      results,
      scan: {
        id: crypto.randomUUID(),
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        sourcesSearched,
        productsChecked,
        newCandidates: 0,
        updatedExisting: 0,
        errors
      }
    });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Scan failed") }, { status: 400 });
  }
}
