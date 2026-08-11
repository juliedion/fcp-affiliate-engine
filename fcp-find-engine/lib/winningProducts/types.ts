// Core data model for the Winning Product Finder.
// Every field that isn't directly observed from a source must be marked
// with a DataQuality tag so the UI never presents a guess as a fact.

export type DataQuality = "observed" | "calculated" | "ai_estimated" | "mock" | "unavailable";

export type SourceId =
  | "google_trends"
  | "google_shopping"
  | "amazon"
  | "cjdropshipping"
  | "zendrop"
  | "creator_blogs"
  | "aliexpress"
  | "shopify_supplier_feed"
  | "mavely"
  | "pinterest"
  | "tiktok"
  | "meta_ad_library"
  | "reddit"
  | "youtube"
  | "etsy"
  | "csv_upload";

export type FortCategory =
  | "Home Organization"
  | "Kitchen Helpers"
  | "Cleaning"
  | "Family Life"
  | "Kids"
  | "Pets"
  | "Outdoor"
  | "Travel"
  | "Car Accessories"
  | "Gifts"
  | "Seasonal"
  | "Everyday Problem Solvers";

export const FORT_CATEGORIES: FortCategory[] = [
  "Home Organization", "Kitchen Helpers", "Cleaning", "Family Life", "Kids", "Pets",
  "Outdoor", "Travel", "Car Accessories", "Gifts", "Seasonal", "Everyday Problem Solvers"
];

export type CompetitionLevel = "low" | "medium" | "high";
export type TrendStage = "Emerging" | "Gaining Momentum" | "Strong Candidate" | "Saturated" | "Declining" | "Seasonal Opportunity" | "Needs More Data";
export type SeasonalRelevance = "evergreen" | "seasonal";
export type ProductStatus = "new" | "watchlisted" | "rejected" | "testing" | "published";
export type Recommendation = "Test Now" | "Add to Watchlist" | "Research Further" | "Skip" | "Saturated" | "Seasonal — Revisit Later";

// A single data point with full provenance — never a bare number.
export type Signal<T> = {
  value: T;
  quality: DataQuality;
  source: SourceId | "internal";
  collectedAt: string;
};

export type ScoreBreakdown = {
  total: number;
  demandTrend: number;
  socialMomentum: number;
  profitPotential: number;
  competition: number;
  demoPotential: number;
  problemSolving: number;
  fortFit: number;
  shippingSupplier: number;
  customerSentiment: number;
};

export type FortFitBreakdown = {
  total: number;
  familyFriendly: number;
  useful: number;
  fun: number;
  problemSolving: number;
  affordable: number;
  easyToDemonstrate: number;
  socialMediaFriendly: number;
  giftable: number;
  impulseFriendly: number;
  categoryFit: number;
  explanation: string;
};

export type Badge = "rising_fast" | "high_margin" | "easy_to_demo" | "strong_fort_fit" | "giftable" | "high_competition" | "slow_shipping" | "seasonal";

export const BADGE_META: Record<Badge, { label: string; emoji: string }> = {
  rising_fast: { label: "Rising Fast", emoji: "🔥" },
  high_margin: { label: "High Margin", emoji: "💰" },
  easy_to_demo: { label: "Easy to Demonstrate", emoji: "🎥" },
  strong_fort_fit: { label: "Strong Fort Fit", emoji: "🏠" },
  giftable: { label: "Giftable", emoji: "🎁" },
  high_competition: { label: "High Competition", emoji: "⚠️" },
  slow_shipping: { label: "Slow Shipping", emoji: "🐢" },
  seasonal: { label: "Seasonal", emoji: "📅" }
};

export type SupportingEvidence = {
  label: string;
  detail: string;
  source: SourceId | "internal";
  quality: DataQuality;
  timestamp: string;
};

export type AiResearchSummary = {
  momentumReason: string;
  whoWouldBuy: string;
  problemSolved: string;
  fortFitReason: string;
  bestSeason: string;
  bestPlatform: string;
  contentAngle: string;
  suggestedRetailPrice: number;
  risks: string;
  recommendation: Recommendation;
};

export type ProductOpportunity = {
  id: string;
  title: string;
  url: string;
  image: string | null;
  source: SourceId;
  supplier: string | null;
  category: FortCategory | "Uncategorized";

  supplierCost: Signal<number | null>;
  retailPrice: Signal<number | null>;
  estimatedSellingPrice: number | null;
  estimatedProfit: number | null;
  estimatedMargin: number | null;

  shippingDays: Signal<number | null>;
  rating: Signal<number | null>;
  reviewCount: Signal<number | null>;
  reviewGrowth: Signal<string | null>;
  searchTrend: Signal<string | null>;
  socialEngagement: Signal<string | null>;
  adActivity: Signal<string | null>;

  competitionLevel: CompetitionLevel;
  competingSellers: Signal<number | null>;

  firstDetected: string;
  lastDetected: string;
  trendStage: TrendStage;
  seasonalRelevance: SeasonalRelevance;
  targetAudience: string;
  problemSolved: string;
  demoPotential: "low" | "medium" | "high";
  familyFriendly: boolean;
  impulseFriendly: boolean;
  giftable: boolean;
  problemSolving: boolean;
  demonstrable: boolean;

  score: ScoreBreakdown;
  fortFit: FortFitBreakdown;
  confidence: "low" | "medium" | "high";
  badges: Badge[];
  evidence: SupportingEvidence[];
  aiSummary: AiResearchSummary;

  status: ProductStatus;
  isMock: boolean;
  matchKeys: { canonicalUrl: string; normalizedTitle: string; supplierProductId: string | null; upc: string | null; sku: string | null; asin: string | null };
};

// Adapters produce this — raw, source-observed data plus their own 0-100 sub-scores
// for the dimensions only they can judge (trend direction, social momentum, etc).
// The scoring service turns this into a full ProductOpportunity.
export type ScoringInputs = {
  demandTrendScore: number;
  socialMomentumScore: number;
  ratingScore: number;
  supplierReliabilityScore: number;
};

export type RawProductOpportunity = Omit<ProductOpportunity, "score" | "fortFit" | "badges" | "evidence" | "aiSummary" | "matchKeys" | "status" | "confidence" | "trendStage"> & {
  scoringInputs: ScoringInputs;
  evidenceSeed: SupportingEvidence[];
  confidenceHint?: "low" | "medium" | "high";
  matchKeys: ProductOpportunity["matchKeys"];
};

export type ScoreWeights = {
  demandTrend: number;
  socialMomentum: number;
  profitPotential: number;
  competition: number;
  demoPotential: number;
  problemSolving: number;
  fortFit: number;
  shippingSupplier: number;
  customerSentiment: number;
};

export const DEFAULT_WEIGHTS: ScoreWeights = {
  demandTrend: 20,
  socialMomentum: 15,
  profitPotential: 15,
  competition: 10,
  demoPotential: 10,
  problemSolving: 10,
  fortFit: 10,
  shippingSupplier: 5,
  customerSentiment: 5
};

export type SourceConfig = {
  id: SourceId;
  label: string;
  enabled: boolean;
  requiresApiKey: boolean;
  connected: boolean;
  rateLimitPerScan: number;
  notes: string;
};

export const DEFAULT_SOURCES: SourceConfig[] = [
  { id: "google_trends", label: "Google Trends (via SerpApi)", enabled: true, requiresApiKey: true, connected: false, rateLimitPerScan: 4, notes: "Live via SerpApi's licensed Trends data (SERPAPI_KEY). Capped at 4 keyword lookups per scan to stay within the free tier — falls back to mock data if the key is missing." },
  { id: "google_shopping", label: "Google Shopping (via SerpApi)", enabled: true, requiresApiKey: true, connected: false, rateLimitPerScan: 4, notes: "Live via SerpApi — real retail listings with real ratings/reviews/prices, filtered to products with 15+ reviews (already validated as selling). Shares the same SerpApi quota as Google Trends." },
  { id: "amazon", label: "Amazon (via SerpApi)", enabled: true, requiresApiKey: true, connected: false, rateLimitPerScan: 3, notes: "Live via SerpApi — real Amazon listings with real ratings/reviews and, when available, \"bought in past month\" recent sales velocity (the strongest real demand signal we have). Shares the same SerpApi quota as Trends/Shopping." },
  { id: "cjdropshipping", label: "CJdropshipping", enabled: true, requiresApiKey: true, connected: false, rateLimitPerScan: 3, notes: "Live — real supplier cost and catalog data via CJ_EMAIL/CJ_API_KEY. Capped at 3 category lookups per scan. No demand/social signal (pair with Google Trends for that)." },
  { id: "zendrop", label: "Zendrop", enabled: true, requiresApiKey: true, connected: false, rateLimitPerScan: 4, notes: "Live — real supplier cost, shipping estimate, and catalog data via Zendrop's MCP API (ZENDROP_API_KEY). Capped at 4 category lookups per scan (120 reads/min limit). No demand/social signal (pair with Google Trends for that)." },
  { id: "creator_blogs", label: "Creator Blogs", enabled: true, requiresApiKey: false, connected: true, rateLimitPerScan: 2, notes: "Live — reads public post titles/links from configured home & lifestyle blogs (ourpnwhome.com, moneysavingmom.com) as a product-idea signal. No price/cost/rating data; not a supplier. Instagram/Facebook-only accounts are intentionally excluded (no compliant scraping path — see Settings for details)." },
  { id: "aliexpress", label: "AliExpress affiliate", enabled: true, requiresApiKey: true, connected: false, rateLimitPerScan: 10, notes: "Requires AliExpress affiliate credentials." },
  { id: "shopify_supplier_feed", label: "Shopify supplier feeds", enabled: false, requiresApiKey: true, connected: false, rateLimitPerScan: 10, notes: "Connect a supplier feed URL in Settings." },
  { id: "mavely", label: "Mavely affiliate catalog", enabled: false, requiresApiKey: true, connected: false, rateLimitPerScan: 10, notes: "Requires Mavely partner API key." },
  { id: "pinterest", label: "Pinterest trends", enabled: true, requiresApiKey: true, connected: false, rateLimitPerScan: 10, notes: "Requires Pinterest API access token." },
  { id: "tiktok", label: "TikTok Creative Center", enabled: false, requiresApiKey: true, connected: false, rateLimitPerScan: 5, notes: "Only used when officially accessible via TikTok's Creative Center exports." },
  { id: "meta_ad_library", label: "Meta Ad Library", enabled: true, requiresApiKey: false, connected: false, rateLimitPerScan: 10, notes: "Meta Ad Library is public but rate-limited; using mock data until wired to the public API." },
  { id: "reddit", label: "Reddit (public)", enabled: true, requiresApiKey: false, connected: false, rateLimitPerScan: 10, notes: "Public JSON endpoints; using mock data until connected." },
  { id: "youtube", label: "YouTube search trends", enabled: true, requiresApiKey: true, connected: false, rateLimitPerScan: 10, notes: "Requires YOUTUBE_API_KEY." },
  { id: "etsy", label: "Etsy marketplace trends", enabled: false, requiresApiKey: true, connected: false, rateLimitPerScan: 10, notes: "Requires Etsy API key." },
  { id: "csv_upload", label: "User-uploaded CSV", enabled: true, requiresApiKey: false, connected: true, rateLimitPerScan: 500, notes: "Fully functional — upload your own supplier catalog." }
];

export type ScheduleFrequency = "manual" | "daily" | "weekly";

export type ScheduleSettings = {
  frequency: ScheduleFrequency;
  categories: FortCategory[];
  sources: SourceId[];
  lastRunAt: string | null;
};

export type ScanRecord = {
  id: string;
  startedAt: string;
  durationMs: number;
  sourcesSearched: SourceId[];
  productsChecked: number;
  newCandidates: number;
  updatedExisting: number;
  errors: { source: SourceId; message: string }[];
};

export type WatchlistSnapshot = {
  capturedAt: string;
  searchTrend: string | null;
  reviewCount: number | null;
  rating: number | null;
  supplierCost: number | null;
  retailPrice: number | null;
  competitionLevel: CompetitionLevel;
  socialEngagement: string | null;
  adActivity: string | null;
  shippingDays: number | null;
  score: number;
};

export type WatchlistAlert = { message: string; severity: "info" | "warning" | "positive"; at: string };

export type WatchlistEntry = {
  productId: string;
  addedAt: string;
  snapshots: WatchlistSnapshot[];
  alerts: WatchlistAlert[];
};

export type DiscoverFilters = {
  category: FortCategory | "all";
  source: SourceId | "all";
  supplier: string;
  minPrice: number | null;
  maxPrice: number | null;
  minMargin: number | null;
  maxCost: number | null;
  maxShippingDays: number | null;
  competition: CompetitionLevel | "all";
  trendStage: TrendStage | "all";
  country: string;
  seasonal: SeasonalRelevance | "all";
  familyFriendlyOnly: boolean;
  problemSolvingOnly: boolean;
  demonstrableOnly: boolean;
  impulseBuyOnly: boolean;
  minFortScore: number | null;
};

export const DEFAULT_FILTERS: DiscoverFilters = {
  category: "all", source: "all", supplier: "", minPrice: null, maxPrice: null, minMargin: null,
  maxCost: null, maxShippingDays: null, competition: "all", trendStage: "all", country: "US",
  seasonal: "all", familyFriendlyOnly: false, problemSolvingOnly: false, demonstrableOnly: false,
  impulseBuyOnly: false, minFortScore: null
};

export type SortKey = "score" | "fortFit" | "growth" | "margin" | "competition" | "shipping" | "recent" | "cost";

// --- Research extensions: profitability, trend evidence, competitors, suppliers, score overrides ---
// Stored separately from ProductOpportunity (keyed by product id) so a re-scan that
// recomputes the automated score/fields never wipes out manually-entered research.

export type SupplierType = "CJ Dropshipping" | "Zendrop" | "AutoDS" | "Alibaba" | "AliExpress" | "Private supplier" | "US wholesaler" | "Manual supplier";

export type SupplierOption = {
  id: string;
  supplierType: SupplierType;
  supplierName: string;
  productCost: number | null;
  shippingCost: number | null;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  processingDays: number | null;
  warehouse: string;
  moq: number | null;
  brandingOptions: boolean;
  packagingOptions: boolean;
  inventory: string;
  supplierRating: number | null;
  refundPolicy: string;
  sampleStatus: "Not requested" | "Requested" | "Received" | "Approved";
  lastVerified: string | null;
  notes: string;
};

export type CompetitorPlatform = "Shopify" | "Amazon" | "TikTok Shop" | "Etsy" | "Major Retailer";

export type CompetitorRecord = {
  id: string;
  platform: CompetitorPlatform;
  url: string;
  storeName: string;
  productTitle: string;
  price: number | null;
  discount: string;
  bundle: string;
  shippingOffer: string;
  reviews: number | null;
  rating: number | null;
  positioning: string;
  marketingAngle: string;
  strengths: string;
  weaknesses: string;
  landingPageNotes: string;
  creativeExamples: string;
  dateReviewed: string;
};

export type TrendMetricCategory = "Social engagement" | "Ad longevity" | "Review growth" | "Search growth" | "Sales-rank movement" | "Competitor activity" | "Customer comments" | "Seasonal demand" | "Creator coverage" | "Cross-platform appearances";

export type TrendMetricRecord = {
  id: string;
  category: TrendMetricCategory;
  source: string;
  url: string;
  dateCaptured: string;
  metric: string;
  currentValue: string;
  previousValue: string;
  growthPercent: number | null;
  notes: string;
  confidence: "low" | "medium" | "high";
};

export type ScoreFactorKey = keyof Omit<ScoreBreakdown, "total">;

export type ScoreFactorOverride = {
  factor: ScoreFactorKey;
  manualValue: number | null; // null = defer to the automated value
  explanation: string;
  confidence: "low" | "medium" | "high";
  lastUpdated: string;
};

export type ProfitabilityInputs = {
  sellingPrice: number;
  productCost: number;
  shipping: number;
  packaging: number;
  shopifyFeePercent: number;
  paymentProcessingPercent: number;
  advertisingCostPerOrder: number;
  refundRatePercent: number;
  returnRatePercent: number;
  discountPercent: number;
  bundleDiscountPercent: number;
  taxPercent: number;
};

export const DEFAULT_PROFITABILITY_INPUTS: ProfitabilityInputs = {
  sellingPrice: 0, productCost: 0, shipping: 0, packaging: 0.5,
  shopifyFeePercent: 2.9, paymentProcessingPercent: 0.3, advertisingCostPerOrder: 8,
  refundRatePercent: 3, returnRatePercent: 2, discountPercent: 0, bundleDiscountPercent: 0, taxPercent: 0
};

export type ProfitabilityOutputs = {
  landedCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  contributionMargin: number;
  breakEvenCpa: number;
  targetCpa: number;
  breakEvenRoas: number;
  profitPerOrder: number;
  profitAt10: number;
  profitAt50: number;
  profitAt100: number;
  profitAt500: number;
  bestCase: number;
  expectedCase: number;
  worstCase: number;
};

export type AdapterSearchParams = {
  categories: FortCategory[];
  country: string;
  limit: number;
  // When set, adapters search for this specific term instead of picking a random
  // keyword from the category pool — this is what powers the free-text search box.
  keyword?: string;
};

export type AdapterResult = {
  source: SourceId;
  products: RawProductOpportunity[];
  isMock: boolean;
  error: string | null;
  requestsUsed: number;
};

// Every source integration implements this. Real integrations call an official
// API/feed server-side using an env-var API key; until connected, `run` returns
// clearly-labeled mock data instead of failing the whole scan.
export interface SourceAdapter {
  id: SourceId;
  label: string;
  isConnected(): boolean;
  run(params: AdapterSearchParams): Promise<AdapterResult>;
}

