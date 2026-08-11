import { canonicalizeUrl, normalizeTitle } from "../dedupe";
import { AdapterResult, CompetitionLevel, FortCategory, RawProductOpportunity } from "../types";

// The only fully "live" adapter: parses a user-uploaded CSV supplier catalog client-side.
// Expected columns (header row, case-insensitive): title, url, image, supplier, category,
// cost, price, shippingDays, rating, reviewCount, competition, upc, sku, asin, audience, problem
export function parseSupplierCsv(csvText: string): { rows: Record<string, string>[]; errors: string[] } {
  const errors: string[] = [];
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["CSV needs a header row plus at least one product row."] };

  const splitLine = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { cells.push(current); current = ""; continue; }
      current += ch;
    }
    cells.push(current);
    return cells.map(c => c.trim());
  };

  const headers = splitLine(lines[0]).map(h => h.toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (cells.length !== headers.length) { errors.push(`Row ${i + 1} has ${cells.length} columns, expected ${headers.length} — skipped.`); continue; }
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx]; });
    rows.push(row);
  }
  return { rows, errors };
}

export function csvRowsToOpportunities(rows: Record<string, string>[], defaultCategory: FortCategory): RawProductOpportunity[] {
  const now = new Date().toISOString();
  return rows.map((row, i) => {
    const cost = row.cost ? Number(row.cost) : null;
    const price = row.price ? Number(row.price) : null;
    const margin = cost && price && price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null;
    const shippingDays = row.shippingdays ? Number(row.shippingdays) : null;
    const rating = row.rating ? Number(row.rating) : null;
    const reviewCount = row.reviewcount ? Number(row.reviewcount) : null;
    const competition = (["low", "medium", "high"].includes((row.competition || "").toLowerCase()) ? row.competition.toLowerCase() : "medium") as CompetitionLevel;
    const title = row.title || `Untitled product ${i + 1}`;
    const url = row.url || "";

    return {
      id: `csv_upload-${Date.now()}-${i}`,
      title,
      url,
      image: row.image || null,
      source: "csv_upload",
      supplier: row.supplier || "Your uploaded catalog",
      category: (row.category as FortCategory) || defaultCategory,
      supplierCost: { value: cost, quality: cost !== null ? "observed" : "unavailable", source: "csv_upload", collectedAt: now },
      retailPrice: { value: price, quality: price !== null ? "observed" : "unavailable", source: "csv_upload", collectedAt: now },
      estimatedSellingPrice: price,
      estimatedProfit: cost !== null && price !== null ? Math.round((price - cost) * 100) / 100 : null,
      estimatedMargin: margin,
      shippingDays: { value: shippingDays, quality: shippingDays !== null ? "observed" : "unavailable", source: "csv_upload", collectedAt: now },
      rating: { value: rating, quality: rating !== null ? "observed" : "unavailable", source: "csv_upload", collectedAt: now },
      reviewCount: { value: reviewCount, quality: reviewCount !== null ? "observed" : "unavailable", source: "csv_upload", collectedAt: now },
      reviewGrowth: { value: null, quality: "unavailable", source: "csv_upload", collectedAt: now },
      searchTrend: { value: null, quality: "unavailable", source: "csv_upload", collectedAt: now },
      socialEngagement: { value: null, quality: "unavailable", source: "csv_upload", collectedAt: now },
      adActivity: { value: null, quality: "unavailable", source: "csv_upload", collectedAt: now },
      competitionLevel: competition,
      competingSellers: { value: null, quality: "unavailable", source: "csv_upload", collectedAt: now },
      firstDetected: now,
      lastDetected: now,
      seasonalRelevance: "evergreen",
      targetAudience: row.audience || "Not enough verified data.",
      problemSolved: row.problem || "Not enough verified data.",
      demoPotential: "medium",
      familyFriendly: true,
      impulseFriendly: price !== null ? price <= 35 : false,
      giftable: false,
      problemSolving: Boolean(row.problem),
      demonstrable: true,
      isMock: false,
      scoringInputs: {
        demandTrendScore: 30,
        socialMomentumScore: 25,
        ratingScore: rating !== null ? Math.round(((rating - 3) / 2) * 100) : 40,
        supplierReliabilityScore: 55
      },
      evidenceSeed: [
        { label: "CSV upload", detail: "Values taken directly from your uploaded supplier catalog.", source: "csv_upload", quality: "observed", timestamp: now }
      ],
      confidenceHint: "medium",
      matchKeys: {
        canonicalUrl: url ? canonicalizeUrl(url) : "",
        normalizedTitle: normalizeTitle(title),
        supplierProductId: row.supplierproductid || null,
        upc: row.upc || null,
        sku: row.sku || null,
        asin: row.asin || null
      }
    };
  });
}

export function csvAdapterResult(rows: Record<string, string>[], parseErrors: string[], defaultCategory: FortCategory): AdapterResult {
  return {
    source: "csv_upload",
    products: csvRowsToOpportunities(rows, defaultCategory),
    isMock: false,
    error: parseErrors.length ? parseErrors.join(" ") : null,
    requestsUsed: 0
  };
}
