import { CompetitionLevel, FortCategory, RawProductOpportunity, SeasonalRelevance, SourceId } from "../types";
import { canonicalizeUrl, normalizeTitle } from "../dedupe";
import { inferCategoryFromKeyword } from "../inference";

export const CATEGORY_PRODUCT_POOL: Record<FortCategory, string[]> = {
  "Home Organization": ["Collapsible Drawer Organizer", "Under-Sink Storage Rack", "Modular Closet Bin Set", "Over-the-Door Pantry Rack"],
  "Kitchen Helpers": ["Magnetic Knife Strip", "One-Hand Herb Chopper", "Silicone Stretch Lids Set", "Cabinet Spice Organizer"],
  "Cleaning": ["Reusable Microfiber Mop Pads", "Handheld Steam Cleaner", "Grout Cleaning Brush Kit", "Pet Hair Removal Roller"],
  "Family Life": ["Wall-Mounted Family Command Center", "Kids' Chore Chart Board", "Weekly Meal Planning Pad", "Entryway Backpack Station"],
  "Kids": ["Sensory Fidget Toy Set", "Travel Activity Lap Desk", "Glow-in-the-Dark Bath Toys", "Toddler Splash Mat"],
  "Pets": ["No-Spill Slow Feeder Bowl", "Retractable Pet Leash", "Cat Self-Groomer Corner Brush", "Portable Dog Water Bottle"],
  "Outdoor": ["Solar Pathway Lights", "Portable Camping Hammock", "Collapsible Garden Hose", "Foldable Outdoor Picnic Table"],
  "Travel": ["Compression Packing Cubes", "Neck Pillow With Storage Pocket", "Portable Luggage Scale", "TSA-Friendly Toiletry Bottles"],
  "Car Accessories": ["Backseat Organizer With Tablet Holder", "Wireless Car Vacuum", "Magnetic Phone Mount", "Trunk Cargo Organizer"],
  "Gifts": ["Personalized Star Map Print", "Engraved Wooden Watch Box", "Custom Photo Puzzle", "Mini Desktop Zen Garden"],
  "Seasonal": ["LED Icicle String Lights", "Inflatable Pool Lounge Float", "Pumpkin Carving Tool Kit", "Cozy Weighted Blanket"],
  "Everyday Problem Solvers": ["Cordless Handheld Vacuum", "Adjustable Laptop Stand", "Cable Management Clips", "Grip-Strength Jar Opener"]
};

// Picks `count` distinct keywords at random from a category's pool, so repeated scans
// surface different candidates instead of always hitting the same first entry.
export function pickKeywords(category: FortCategory, count: number): string[] {
  const pool = [...CATEGORY_PRODUCT_POOL[category]];
  const picked: string[] = [];
  while (picked.length < Math.min(count, pool.length)) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

// Shared by every real adapter: when the caller supplied a free-text search keyword, run
// exactly one query for that term (category inferred from the term itself). Otherwise fall
// back to the existing behavior of a random keyword per category, capped to maxQueries.
export function resolveQueries(categories: FortCategory[], keyword: string | undefined, maxQueries: number): { category: FortCategory; keyword: string }[] {
  if (keyword) return [{ category: inferCategoryFromKeyword(keyword), keyword }];
  const pool = categories.length ? categories : (Object.keys(CATEGORY_PRODUCT_POOL) as FortCategory[]);
  return pool.slice(0, maxQueries).map(cat => ({ category: cat, keyword: pickKeywords(cat, 1)[0] }));
}

const SUPPLIER_POOL: Record<SourceId, string[]> = {
  google_trends: ["N/A"], google_shopping: ["Multiple Retailers"], amazon: ["Amazon Marketplace Seller"],
  cjdropshipping: ["CJ Verified Supplier"], zendrop: ["Zendrop Verified Supplier"], creator_blogs: ["N/A"], aliexpress: ["AliExpress Top Seller"], shopify_supplier_feed: ["Shopify Wholesale Partner"],
  mavely: ["Mavely Brand Partner"], pinterest: ["N/A"], tiktok: ["TikTok Shop Seller"], meta_ad_library: ["N/A"],
  reddit: ["N/A"], youtube: ["N/A"], etsy: ["Etsy Independent Seller"], csv_upload: ["Your Uploaded Catalog"]
};

const AUDIENCE_POOL = ["busy parents", "small-space renters", "pet owners", "home cooks", "road-trip families", "gift shoppers", "first-time homeowners"];

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

export function generateMockProducts(source: SourceId, categories: FortCategory[], count: number): RawProductOpportunity[] {
  const pool = categories.length ? categories : (Object.keys(CATEGORY_PRODUCT_POOL) as FortCategory[]);
  const products: RawProductOpportunity[] = [];

  for (let i = 0; i < count; i++) {
    const category = pool[i % pool.length];
    const names = CATEGORY_PRODUCT_POOL[category];
    const rand = seededRandom(hashSeed(`${source}-${category}-${i}`));
    const title = names[Math.floor(rand() * names.length)];
    const cost = Math.round((6 + rand() * 22) * 100) / 100;
    const retail = Math.round(cost * (2.2 + rand() * 1.8) * 100) / 100;
    const margin = Math.round(((retail - cost) / retail) * 1000) / 10;
    const competitionRoll = rand();
    const competitionLevel: CompetitionLevel = competitionRoll < 0.33 ? "low" : competitionRoll < 0.7 ? "medium" : "high";
    const shippingDays = Math.round(5 + rand() * 18);
    const demandScore = Math.round(20 + rand() * 78);
    const socialScore = Math.round(15 + rand() * 80);
    const ratingRaw = Math.round((3.6 + rand() * 1.3) * 10) / 10;
    const reviewCount = Math.round(30 + rand() * 4000);
    const seasonal: SeasonalRelevance = category === "Seasonal" || rand() < 0.12 ? "seasonal" : "evergreen";
    const demoPotential: "low" | "medium" | "high" = rand() < 0.55 ? "high" : rand() < 0.8 ? "medium" : "low";
    const familyFriendly = rand() < 0.75;
    const problemSolving = rand() < 0.7;
    const giftable = rand() < 0.5 || category === "Gifts";
    const impulseFriendly = retail <= 35;
    const url = `https://example-${source.replace(/_/g, "-")}.com/products/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, "-"))}-${i}`;
    const now = new Date();
    const firstDetected = new Date(now.getTime() - Math.floor(rand() * 60) * 86400000).toISOString();

    products.push({
      id: `${source}-${hashSeed(url)}-${i}`,
      title,
      url,
      image: null,
      source,
      supplier: SUPPLIER_POOL[source][0],
      category,
      supplierCost: { value: cost, quality: "mock", source, collectedAt: now.toISOString() },
      retailPrice: { value: retail, quality: "mock", source, collectedAt: now.toISOString() },
      estimatedSellingPrice: retail,
      estimatedProfit: Math.round((retail - cost) * 100) / 100,
      estimatedMargin: margin,
      shippingDays: { value: shippingDays, quality: "mock", source, collectedAt: now.toISOString() },
      rating: { value: ratingRaw, quality: "mock", source, collectedAt: now.toISOString() },
      reviewCount: { value: reviewCount, quality: "mock", source, collectedAt: now.toISOString() },
      reviewGrowth: { value: `${rand() < 0.5 ? "+" : ""}${Math.round((rand() - 0.3) * 40)}% last 30 days`, quality: "mock", source, collectedAt: now.toISOString() },
      searchTrend: { value: demandScore >= 60 ? "Rising" : demandScore >= 35 ? "Steady" : "Softening", quality: "mock", source, collectedAt: now.toISOString() },
      socialEngagement: { value: socialScore >= 60 ? "High engagement" : socialScore >= 35 ? "Moderate engagement" : "Low engagement", quality: "mock", source, collectedAt: now.toISOString() },
      adActivity: { value: rand() < 0.4 ? "Multiple active ads detected" : rand() < 0.7 ? "A few active ads" : "No active ads detected", quality: "mock", source, collectedAt: now.toISOString() },
      competitionLevel,
      competingSellers: { value: competitionLevel === "low" ? Math.round(rand() * 5) : competitionLevel === "medium" ? Math.round(5 + rand() * 20) : Math.round(25 + rand() * 60), quality: "mock", source, collectedAt: now.toISOString() },
      firstDetected,
      lastDetected: now.toISOString(),
      seasonalRelevance: seasonal,
      targetAudience: AUDIENCE_POOL[Math.floor(rand() * AUDIENCE_POOL.length)],
      problemSolved: problemSolving ? `Reduces the everyday hassle of dealing with ${category.toLowerCase()} tasks` : "No clearly identified problem — primarily an aesthetic or novelty item",
      demoPotential,
      familyFriendly,
      impulseFriendly,
      giftable,
      problemSolving,
      demonstrable: demoPotential !== "low",
      isMock: true,
      scoringInputs: {
        demandTrendScore: demandScore,
        socialMomentumScore: socialScore,
        ratingScore: Math.round(((ratingRaw - 3) / 2) * 100),
        supplierReliabilityScore: Math.round(60 + rand() * 35)
      },
      evidenceSeed: [
        { label: "Mock demand signal", detail: `Simulated search-interest trend from ${source.replace(/_/g, " ")} (mock data — not a real integration yet).`, source, quality: "mock", timestamp: now.toISOString() }
      ],
      confidenceHint: "low",
      matchKeys: {
        canonicalUrl: canonicalizeUrl(url),
        normalizedTitle: normalizeTitle(title),
        supplierProductId: null,
        upc: null,
        sku: null,
        asin: source === "amazon" ? `B0MOCK${i}${hashSeed(title).toString().slice(0, 4)}` : null
      }
    });
  }

  return products;
}
