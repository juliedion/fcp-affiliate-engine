import { buildMerchandising, buildPricingEngine, recommendProduct, scoreProduct } from "./generator";
import { ProductInput } from "./types";

export type ScrapedProduct = {
  title: string | null;
  price: number | null;
  images: string[];
  description: string | null;
};

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

// Plain .includes() substring matching was matching category keywords inside unrelated
// words — e.g. "pan" (Kitchen) inside "companion", or "cook" inside "cookie" for a non-food
// product — which misclassified products into the wrong category entirely. Word-boundary
// matching only counts a keyword as present when it's a whole word.
function hasKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

const metaContent = (html: string, attr: "property" | "name", key: string): string | null => {
  const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, "i");
  const reReversed = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, "i");
  const match = html.match(re) || html.match(reReversed);
  return match ? decodeEntities(match[1]) : null;
};

const allMetaContent = (html: string, attr: "property" | "name", key: string): string[] => {
  const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, "gi");
  return Array.from(html.matchAll(re)).map(m => decodeEntities(m[1]));
};

function extractJsonLdPrice(html: string): number | null {
  const scripts = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  for (const s of scripts) {
    try {
      const parsed = JSON.parse(s[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const offers = item?.offers;
        const price = offers?.price ?? offers?.[0]?.price;
        if (price) {
          const n = Number(price);
          if (!Number.isNaN(n) && n > 0) return n;
        }
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return null;
}

function extractPrice(html: string): number | null {
  const metaPrice = metaContent(html, "property", "og:price:amount") || metaContent(html, "property", "product:price:amount");
  if (metaPrice) {
    const n = Number(metaPrice);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const jsonLdPrice = extractJsonLdPrice(html);
  if (jsonLdPrice) return jsonLdPrice;
  // Amazon-specific patterns — Amazon strips og:price and JSON-LD offers from most product
  // pages, so price lives in one of these markup shapes depending on which page variant is served.
  const offscreenMatch = html.match(/class="a-offscreen">\$([\d,]+\.\d{2})</);
  if (offscreenMatch) {
    const n = Number(offscreenMatch[1].replace(/,/g, ""));
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const priceAmountMatch = html.match(/"priceAmount":\s*([\d.]+)/);
  if (priceAmountMatch) {
    const n = Number(priceAmountMatch[1]);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  // Deliberately no generic "any $XX.XX on the page" fallback — that matched unrelated
  // numbers (ad prices, CSS, other products) and produced fake prices. If none of the
  // structured patterns above find a price, it's genuinely unavailable from this page.
  return null;
}

const GENERIC_TITLE_VALUES = new Set(["amazon", "amazon.com", "walmart", "walmart.com", "target", "target.com", "etsy", "ebay", "qvc", "qvc.com"]);

// Amazon (and some other retailers) deliberately serve a generic og:title/og:image for
// social-preview purposes ("Amazon", a generic logo) instead of the real product info,
// even though the actual product title is sitting right there in the plain <title> tag.
// Trusting og:title unconditionally was producing a fake "Amazon" product name.
function isGenericTitle(t: string | null): boolean {
  if (!t) return true;
  return GENERIC_TITLE_VALUES.has(t.trim().toLowerCase());
}

// Amazon's <title> tag is "Amazon.com : <product name> : <category1, category2>" on most
// listings, but some serve "Amazon.com - <product name>" (hyphen instead of colon) or an
// en-dash/em-dash variant — and the product name itself is routinely 150-200+ characters of
// keyword-stuffed marketing copy. Passing that straight through as a storefront product title
// renders as an unreadable wall of text (or literally starts with "Amazon.com - ") regardless
// of theme styling, so this strips the site-name wrapper (whichever separator it used) AND
// shortens the remaining name to a clean, readable title at a word/comma boundary.
const MAX_TITLE_LENGTH = 80;
const TITLE_SEPARATORS = [" : ", " - ", " – ", " — "];

function cleanAmazonTitle(raw: string): string {
  let title = raw.replace(/^amazon\.com\s*[:\-–—]\s*/i, "").trim();
  // Drop Amazon's trailing " : Category, Subcategory" (or " - "/" – "/" — " variant) breadcrumb suffix, if present.
  const lastSeparatorIndex = Math.max(...TITLE_SEPARATORS.map(sep => title.lastIndexOf(sep)));
  if (lastSeparatorIndex > MAX_TITLE_LENGTH * 0.5) title = title.slice(0, lastSeparatorIndex).trim();
  return shortenTitle(title);
}

function shortenTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  // Prefer cutting at the first comma (Amazon titles are usually "Core Name, feature, feature...")
  // so the shortened title is still a real product name, not a mid-sentence fragment.
  const firstComma = title.indexOf(",");
  if (firstComma > 15 && firstComma <= MAX_TITLE_LENGTH) return title.slice(0, firstComma).trim();
  const truncated = title.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim();
}

function extractAmazonHiResImages(html: string): string[] {
  const matches = Array.from(html.matchAll(/"hiRes":"(https:[^"]+)"/g)).map(m => m[1].replace(/\\u002F/g, "/"));
  return Array.from(new Set(matches)).slice(0, 5);
}

// Amazon's og:description is also just "Amazon" — the real product description lives in
// the "About this item" feature-bullet list further down the page.
function extractAmazonFeatureBullets(html: string): string | null {
  // Capture up to 10 bullets (Amazon's "About this item" list is usually 5-8) rather than 5 —
  // this is the richest source of real product specifics available, and the AI copywriter
  // needs the full list to write something genuinely specific rather than generic.
  const bullets = Array.from(html.matchAll(/<span class="a-list-item">\s*([^<]+?)\s*<\/span>/g))
    .map(m => decodeEntities(m[1]))
    .filter(t => t.length > 5)
    .slice(0, 10);
  return bullets.length ? bullets.join(". ") : null;
}

// Claiming to be a full desktop Chrome browser via User-Agent while not sending the other
// headers real Chrome always sends (sec-ch-ua, Sec-Fetch-Site, Sec-Fetch-Mode, etc.) is a
// more suspicious, inconsistent fingerprint to bot detection than an honest custom UA that
// doesn't pretend to be something it isn't — confirmed in production, where impersonating
// Chrome caused Amazon to fully block requests from Vercel's IPs that previously got partial
// data through. Keep the plain, honest identifier.
const SCRAPE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; FortCrazypantsBot/1.0; +https://fortcrazypants.com)"
};

// If Amazon serves its interstitial "Type the characters you see" bot-check page instead of
// the real product page, every price/description pattern below will legitimately find
// nothing — that's not a missing pattern, it's a blocked request. Detecting it explicitly
// lets the UI say "Amazon blocked this request" instead of the misleading "no price found
// on this page", since the latter implies the product genuinely has no listed price.
function isBotCheckPage(html: string): boolean {
  return /Type the characters you see|api-services-support@amazon\.com|Enter the characters you see below/i.test(html);
}

export async function scrapeProduct(url: string): Promise<ScrapedProduct & { blocked?: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let html = "";
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: SCRAPE_HEADERS
    });
    html = await response.text();
  } finally {
    clearTimeout(timeout);
  }

  if (isBotCheckPage(html)) {
    return { title: null, price: null, images: [], description: null, blocked: true };
  }

  const ogTitle = metaContent(html, "property", "og:title");
  const titleTagMatch = html.match(/<title>([^<]*)<\/title>/i);
  const titleTag = titleTagMatch ? cleanAmazonTitle(decodeEntities(titleTagMatch[1])) : null;
  const title = !isGenericTitle(ogTitle) ? ogTitle : (!isGenericTitle(titleTag) ? titleTag : (ogTitle || titleTag));

  const price = extractPrice(html);

  const ogImages = allMetaContent(html, "property", "og:image").filter(src => !/share-icons|\/logo[./]/i.test(src));
  const images = ogImages.length > 0 ? Array.from(new Set(ogImages)).slice(0, 5) : extractAmazonHiResImages(html);

  const ogDescription = metaContent(html, "property", "og:description") || metaContent(html, "name", "description");
  const description = !isGenericTitle(ogDescription) ? ogDescription : extractAmazonFeatureBullets(html);

  return { title, price, images, description };
}

const CATEGORY_TAXONOMY: { category: string; audience: string; problem: string; demoFactor: number; keywords: string[] }[] = [
  { category: "Home Organization", audience: "busy families and small-space organizers", problem: "cluttered spaces with no convenient home for everyday items", demoFactor: 8, keywords: ["organizer", "storage", "closet", "shelf", "cart", "bin", "declutter", "pantry"] },
  { category: "Kitchen", audience: "home cooks and busy families", problem: "slow, messy, or frustrating kitchen tasks", demoFactor: 8, keywords: ["kitchen", "cook", "chef", "utensil", "gadget", "blender", "knife", "pan"] },
  { category: "Beauty & Personal Care", audience: "beauty and self-care enthusiasts", problem: "time-consuming or ineffective beauty routines", demoFactor: 7, keywords: ["skincare", "beauty", "hair", "makeup", "facial", "brush", "serum"] },
  { category: "Fitness & Wellness", audience: "fitness-focused adults", problem: "inconsistent workouts or lack of the right equipment at home", demoFactor: 7, keywords: ["fitness", "workout", "exercise", "yoga", "gym", "muscle", "wellness"] },
  { category: "Tech & Gadgets", audience: "tech-savvy early adopters", problem: "clunky, outdated, or inconvenient everyday tech", demoFactor: 8, keywords: ["gadget", "tech", "smart", "charger", "wireless", "bluetooth", "device", "electronic"] },
  { category: "Baby & Kids", audience: "parents of young children", problem: "everyday challenges of caring for young kids", demoFactor: 7, keywords: ["baby", "infant", "toddler", "kids", "nursery", "stroller"] },
  { category: "Pet Supplies", audience: "pet owners", problem: "everyday hassles of pet care and cleanup", demoFactor: 7, keywords: ["pet", "dog", "cat", "leash", "collar", "litter"] },
  { category: "Pest Control", audience: "homeowners dealing with bugs and pests", problem: "mosquitoes, flies, and other pests ruining time outdoors or indoors", demoFactor: 7, keywords: ["mosquito", "insect", "bug zapper", "pest", "repellent", "fly trap", "rodent", "ant"] },
  { category: "Outdoor & Garden", audience: "outdoor and gardening enthusiasts", problem: "inefficient or frustrating outdoor upkeep", demoFactor: 6, keywords: ["outdoor", "garden", "patio", "yard", "plant", "lawn"] },
  { category: "Apparel & Accessories", audience: "style-conscious shoppers", problem: "uncomfortable, impractical, or hard-to-style everyday wear", demoFactor: 5, keywords: ["shirt", "dress", "jacket", "shoes", "apparel", "wear", "accessory"] }
];

const DEFAULT_TAXONOMY = { category: "General Merchandise", audience: "busy households", problem: "an everyday inconvenience", demoFactor: 6 };

export type InferredField = "name" | "price" | "cost" | "category" | "audience" | "problem" | "features" | "shippingDays" | "competition" | "demoFactor";

export type InferenceResult = {
  input: ProductInput;
  scrapedFields: InferredField[];
  estimatedFields: InferredField[];
};

// Merchant detection beyond the original Amazon-only check. Order matters: Amazon is
// checked first (existing behavior, unaffected). None of these ever modify/strip the URL's
// query string — tracking params (Amazon `tag=`, Mavely-style click IDs, etc.) must survive
// verbatim since they're how the affiliate commission gets attributed. See lib/scrape.test.ts
// for an explicit regression test on that.
function detectMerchantAndNetwork(url: string): { isAffiliate: boolean; merchant: string; network: string } {
  let hostname = "";
  try {
    hostname = new URL(url, "https://example.com").hostname.toLowerCase();
  } catch {
    return { isAffiliate: false, merchant: "", network: "" };
  }

  if (/(^|\.)amazon\.[a-z.]+$|^amzn\.to$/i.test(hostname)) {
    return { isAffiliate: true, merchant: "Amazon", network: "Amazon Associates" };
  }
  if (/(^|\.)walmart\.com$|^wmt\.co$/i.test(hostname)) {
    return { isAffiliate: true, merchant: "Walmart", network: "Impact" };
  }
  if (/(^|\.)target\.com$|^tgt\.gs$/i.test(hostname)) {
    return { isAffiliate: true, merchant: "Target", network: "Impact" };
  }
  // Mavely-style affiliate links: either the mavely.app/co link-shortener domain itself, or
  // a merchant URL carrying Mavely's own tracking param (its browser extension appends
  // "mavely" or "avantlink"-style params to the destination URL rather than always
  // redirecting through a mavely.app short link).
  if (/(^|\.)mavely\.(app|co)$/i.test(hostname) || /[?&](mavely|mv_)[a-z_]*=/i.test(url)) {
    return { isAffiliate: true, merchant: "Mavely", network: "Mavely" };
  }
  return { isAffiliate: false, merchant: "", network: "" };
}

// Test-only export — kept as a thin named re-export rather than exporting the internal
// function directly under its real name, so it stays clearly marked as an internal detail
// exposed for unit testing (lib/affiliate.test.ts), not part of this module's public API.
export const detectMerchantAndNetworkForTest = detectMerchantAndNetwork;

export type ResearchSummary = {
  image: string | null;
  supplierPrice: number;
  suggestedRetail: number;
  profit: number;
  margin: number;
  shippingTime: string;
  competitionLevel: "low" | "medium" | "high";
  googleTrendsSummary: string;
  amazonRating: number;
  reviewCount: number;
  bestKeywords: string[];
  suggestedAudience: string;
  topSellingSeason: string;
  suggestedCategories: string[];
  fortScore: number;
  opportunityScore: number;
  socialMediaPotential: string;
};

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const SOCIAL_LABELS = ["", "Very Low", "Low", "Moderate", "High", "Very High"];

export function buildResearchSummary(scraped: ScrapedProduct, inference: InferenceResult): ResearchSummary {
  const input = inference.input;
  const { score, margin } = scoreProduct(input);
  const recommendation = recommendProduct(input, score);
  const featureList = input.features.split(/[,\n]/).map(v => v.trim()).filter(Boolean).slice(0, 6);
  const merch = buildMerchandising(input, input.name || "This product", featureList, score, margin);
  const pricing = buildPricingEngine(input);
  const suggestedRetail = pricing.tiers.find(t => t.key === "suggestedRetail")!.value;
  const profit = pricing.tiers.find(t => t.key === "expectedProfit")!.value;
  const targetMargin = pricing.tiers.find(t => t.key === "targetMargin")!.value;

  const socialRating = recommendation.ratings.find(r => r.key === "socialMediaPotential")!;
  const avgStars = recommendation.ratings.reduce((s, r) => s + r.stars, 0) / recommendation.ratings.length;
  const opportunityScore = Math.round(clamp((score + avgStars * 20) / 2, 0, 100));

  const text = `${input.name} ${input.category}`.toLowerCase();
  const categoryMatches = CATEGORY_TAXONOMY.filter(t => t.keywords.some(k => hasKeyword(text, k))).map(t => t.category);
  const suggestedCategories = Array.from(new Set(categoryMatches.length ? categoryMatches : [input.category])).slice(0, 3);

  const amazonRating = Math.round((3.6 + (score / 100) * 1.3) * 10) / 10;
  const reviewBase = input.competition === "high" ? 1400 : input.competition === "medium" ? 500 : 150;
  const reviewCount = Math.round(reviewBase * (input.price > 0 ? Math.max(0.4, 40 / input.price) : 1));

  const googleTrendsSummary = `Search interest for "${input.category || "this category"}" products is ${input.competition === "high" ? "high and steady" : input.competition === "medium" ? "moderate with room to grow" : "emerging with lower competition"}, typically peaking around ${merch.bestSeason.split(",")[0]}.`;

  return {
    image: scraped.images[0] || null,
    supplierPrice: input.cost,
    suggestedRetail,
    profit,
    margin: targetMargin,
    shippingTime: `${input.shippingDays} day${input.shippingDays === 1 ? "" : "s"}`,
    competitionLevel: input.competition,
    googleTrendsSummary,
    amazonRating,
    reviewCount,
    bestKeywords: merch.topKeywords,
    suggestedAudience: input.audience,
    topSellingSeason: merch.bestSeason,
    suggestedCategories,
    fortScore: score,
    opportunityScore,
    socialMediaPotential: `${SOCIAL_LABELS[socialRating.stars]} (${socialRating.stars}/5)`
  };
}

export function inferProductInput(scraped: ScrapedProduct, url: string): InferenceResult {
  const scrapedFields: InferredField[] = [];
  const estimatedFields: InferredField[] = [];

  // "New Find" is an honest placeholder for a blank form, not a real product name — leaving it
  // empty when the scrape found nothing forces the UI to visibly flag this instead of silently
  // shipping a fake title through to generation.
  const name = scraped.title || "";
  if (scraped.title) scrapedFields.push("name"); else estimatedFields.push("name");

  // A flat $29.99 fallback here was presenting a made-up number as if it were the real
  // price whenever a page didn't expose one (e.g. Amazon listings that load price via JS) —
  // same class of bug as the earlier fake "$10". Leaving it at 0 forces the "no real price
  // found" warning below instead of silently showing a plausible-looking wrong number.
  const price = scraped.price ?? 0;
  if (scraped.price) scrapedFields.push("price"); else estimatedFields.push("price");

  const cost = Math.round(price * 0.35 * 100) / 100;
  estimatedFields.push("cost");

  const text = `${scraped.title || ""} ${scraped.description || ""}`.toLowerCase();
  const matched = CATEGORY_TAXONOMY.find(t => t.keywords.some(k => hasKeyword(text, k))) || DEFAULT_TAXONOMY;
  estimatedFields.push("category", "audience", "problem", "demoFactor");

  const features = scraped.description
    ? scraped.description.split(/[.,\n]/).map(s => s.trim()).filter(s => s.length > 3).slice(0, 5).join(", ")
    : "durable design, easy to use, compact footprint";
  estimatedFields.push("features");

  estimatedFields.push("shippingDays", "competition");

  // Amazon/Amazon-affiliate-shortlink URLs default to the Amazon Affiliate product type
  // with the URL pre-filled — the common case this app's Amazon-URL import is built for.
  // Non-Amazon merchants (Walmart, Target, Mavely-pattern links) are detected the same way
  // but keep productType as "dropshipping" (that enum only has an Amazon-specific value) —
  // isAffiliateProduct is the field that actually drives the affiliate flow for them.
  const detected = detectMerchantAndNetwork(url);
  const isAmazonUrl = detected.merchant === "Amazon";

  return {
    input: {
      url, // stored verbatim — never strip tracking params like Amazon's tag= or Mavely's click IDs
      name,
      cost,
      price,
      category: matched.category,
      audience: matched.audience,
      problem: matched.problem,
      features,
      shippingDays: 7,
      competition: "medium",
      demoFactor: matched.demoFactor,
      productType: isAmazonUrl ? "amazon_affiliate" : "dropshipping",
      amazonUrl: isAmazonUrl ? url : "",
      affiliateUrl: detected.isAffiliate && !isAmazonUrl ? url : "",
      isAffiliateProduct: detected.isAffiliate,
      merchant: detected.merchant,
      affiliateNetwork: detected.network,
      vendor: detected.isAffiliate ? detected.merchant : "Fort Crazypants",
      compareAtPrice: 0,
      fcpVerdict: "",
      sourceDescription: scraped.description || ""
    },
    scrapedFields,
    estimatedFields
  };
}
