import { AFFILIATE_BUTTON_LABELS, AMAZON_ASSOCIATE_DISCLOSURE, CuratedCollection, CURATED_COLLECTIONS, DEFAULT_AFFILIATE_CTA_TEXT, DEFAULT_CTA_TEXT, GENERIC_AFFILIATE_DISCLOSURE, GeneratedProduct, ImagePrompt, Merchandising, PricingEngine, PricingTier, ProductInput, Rating, Recommendation, RecommendationKey, ScoreFactor, SEOContent, VideoPrompt } from "./types";

// Plain .includes() substring matching on short keywords (e.g. "pan" for Kitchen) matches
// inside unrelated words — "companion" contains "pan" — misfiring category/room/cross-sell
// detection across this whole file. Word-boundary matching only counts a real whole-word hit.
// (Duplicated from lib/scrape.ts rather than imported, to avoid a circular import — scrape.ts
// already imports from this file.)
function hasKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

const CURATED_COLLECTION_KEYWORDS: Record<CuratedCollection, string[]> = {
  "Kitchen": ["kitchen", "cook", "chef", "utensil", "pan", "blender", "knife", "cutting board"],
  "Backyard": ["backyard", "patio", "deck", "yard", "grill", "lawn"],
  "Camping": ["camp", "tent", "hammock", "hiking", "trail", "portable"],
  "Pets": ["pet", "dog", "cat", "leash", "litter", "kennel"],
  "Cleaning": ["clean", "mop", "vacuum", "stain", "laundry", "duster"],
  "Kids": ["kid", "toddler", "child", "baby", "toy", "nursery"],
  "Travel": ["travel", "luggage", "packing", "suitcase", "tsa", "carry-on"],
  "Home Organization": ["organiz", "storage", "closet", "shelf", "declutter", "pantry", "bin"],
  "Office": ["office", "desk", "workspace", "laptop stand", "stationery"],
  "Electronics": ["electronic", "gadget", "charger", "bluetooth", "wireless", "device", "cable"],
  "Garage": ["garage", "tool", "workshop", "car", "workbench"],
  "Holiday": ["christmas", "holiday", "halloween", "valentine", "easter", "thanksgiving", "gift"]
};

// Maps a product's text (title/category/features/problem) onto the fixed set of storefront
// collections, so collection pages stay consistent instead of every product minting its own
// one-off collection name. User can still edit the result before publishing.
export function detectCuratedCollections(text: string): CuratedCollection[] {
  const lower = text.toLowerCase();
  return CURATED_COLLECTIONS.filter(c => CURATED_COLLECTION_KEYWORDS[c].some(k => hasKeyword(lower, k)));
}

// CTA + affiliate disclosure. Generalized beyond the original Amazon-only binary: any
// product with isAffiliateProduct=true (regardless of the ProductType business-model enum)
// links out to its merchant and carries a disclosure. isAffiliateProduct defaults to
// (productType === "amazon_affiliate") wherever ProductInput objects are constructed, so
// existing Amazon Affiliate products behave identically to before this change — same CTA
// text ("Buy on Amazon"), same URL fallback (affiliateUrl || amazonUrl), same exact
// FTC-required disclosure wording. New non-Amazon affiliate products (Walmart,
// Target, Mavely, etc.) get a merchant-suggested CTA label (still user-overridable via
// ctaButtonText on the generated product) and the generic affiliate disclosure — Amazon
// specifically always keeps the FTC wording even if isAffiliateProduct was set independently
// of productType, since that exact wording is a legal requirement for Amazon Associates links.
export function buildCtaAndDisclosure(input: ProductInput): { ctaButtonText: string; ctaButtonUrl: string; disclosureText: string } {
  const isAffiliate = input.isAffiliateProduct ?? input.productType === "amazon_affiliate";
  if (!isAffiliate) {
    return { ctaButtonText: DEFAULT_CTA_TEXT[input.productType], ctaButtonUrl: "", disclosureText: "" };
  }

  const merchant = (input.merchant || (input.productType === "amazon_affiliate" ? "Amazon" : "")).trim();
  const isAmazon = merchant.toLowerCase() === "amazon" || input.productType === "amazon_affiliate";
  const url = input.affiliateUrl || input.amazonUrl || "";

  const suggestedCta = isAmazon
    ? DEFAULT_CTA_TEXT.amazon_affiliate // "Buy on Amazon" — kept in sync with AFFILIATE_BUTTON_LABELS.Amazon
    : merchant && AFFILIATE_BUTTON_LABELS[merchant]
    ? AFFILIATE_BUTTON_LABELS[merchant]
    : DEFAULT_AFFILIATE_CTA_TEXT;

  return {
    ctaButtonText: suggestedCta,
    ctaButtonUrl: url,
    disclosureText: isAmazon ? AMAZON_ASSOCIATE_DISCLOSURE : GENERIC_AFFILIATE_DISCLOSURE
  };
}

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

const FAMILY_KEYWORDS = ["family", "families", "kid", "kids", "children", "parent", "household", "mom", "dad"];
const NON_GIFT_KEYWORDS = ["subscription", "software", "service", "digital", "consumable", "perishable", "intimate"];
const SEASONAL_KEYWORDS = ["christmas", "halloween", "holiday", "valentine", "summer", "winter", "easter", "seasonal", "thanksgiving", "back to school"];

export function scoreProduct(input: ProductInput) {
  const rawMargin = input.price > 0 ? ((input.price - input.cost) / input.price) * 100 : 0;
  const margin = Math.round(rawMargin * 10) / 10;

  const factors: ScoreFactor[] = [];

  if (margin >= 50) factors.push({ label: "High Margin", status: "good", points: 20, max: 20, detail: `${margin}% margin` });
  else if (margin >= 30) factors.push({ label: "Moderate Margin", status: "warning", points: 12, max: 20, detail: `${margin}% margin` });
  else factors.push({ label: "Low Margin", status: "bad", points: 4, max: 20, detail: `${margin}% margin` });

  const demo = clamp(input.demoFactor, 1, 10);
  if (demo >= 7) factors.push({ label: "Strong Visual Demo", status: "good", points: 15, max: 15, detail: `Demo factor ${demo}/10` });
  else if (demo >= 4) factors.push({ label: "Moderate Visual Demo", status: "warning", points: 8, max: 15, detail: `Demo factor ${demo}/10` });
  else factors.push({ label: "Weak Visual Demo", status: "bad", points: 2, max: 15, detail: `Demo factor ${demo}/10` });

  if (input.competition === "low") factors.push({ label: "Low Competition", status: "good", points: 15, max: 15, detail: "Low competition selected" });
  else if (input.competition === "medium") factors.push({ label: "Moderate Competition", status: "warning", points: 8, max: 15, detail: "Medium competition selected" });
  else factors.push({ label: "High Competition", status: "bad", points: 2, max: 15, detail: "High competition selected" });

  const audienceText = `${input.audience} ${input.category}`.toLowerCase();
  if (FAMILY_KEYWORDS.some(k => hasKeyword(audienceText, k))) factors.push({ label: "Family Friendly", status: "good", points: 10, max: 10, detail: "Audience mentions family/home" });
  else factors.push({ label: "Niche Audience", status: "warning", points: 5, max: 10, detail: "Audience not explicitly family-oriented" });

  const problemLen = input.problem.trim().length;
  if (problemLen > 30) factors.push({ label: "Problem Solving", status: "good", points: 15, max: 15, detail: "Clear, detailed problem statement" });
  else if (problemLen > 10) factors.push({ label: "Vague Problem", status: "warning", points: 8, max: 15, detail: "Problem statement is brief" });
  else factors.push({ label: "Unclear Problem", status: "bad", points: 2, max: 15, detail: "Problem statement missing or too short" });

  const giftText = `${input.category} ${input.features} ${input.name}`.toLowerCase();
  if (NON_GIFT_KEYWORDS.some(k => hasKeyword(giftText, k))) factors.push({ label: "Not Giftable", status: "bad", points: 3, max: 10, detail: "Product type is not typically gifted" });
  else if (input.price >= 15 && input.price <= 150) factors.push({ label: "Giftable", status: "good", points: 10, max: 10, detail: `$${input.price} is a giftable price point` });
  else factors.push({ label: "Giftable (Price Dependent)", status: "warning", points: 6, max: 10, detail: `$${input.price} is outside the typical gifting range` });

  if (input.shippingDays <= 7) factors.push({ label: "Fast Shipping", status: "good", points: 10, max: 10, detail: `${input.shippingDays}-day shipping` });
  else if (input.shippingDays <= 12) factors.push({ label: "Shipping Time Average", status: "warning", points: 6, max: 10, detail: `${input.shippingDays}-day shipping` });
  else factors.push({ label: "Slow Shipping", status: "bad", points: 2, max: 10, detail: `${input.shippingDays}-day shipping` });

  const seasonalText = `${input.category} ${input.name} ${input.features}`.toLowerCase();
  if (SEASONAL_KEYWORDS.some(k => hasKeyword(seasonalText, k))) factors.push({ label: "Seasonal Product", status: "bad", points: 1, max: 5, detail: "Tied to a specific season or holiday" });
  else factors.push({ label: "Year-Round Appeal", status: "good", points: 5, max: 5, detail: "Not tied to a season or holiday" });

  const score = Math.round(clamp(factors.reduce((sum, f) => sum + f.points, 0), 0, 100));
  const formula = factors.map(f => `${f.points}/${f.max} (${f.label})`).join(" + ") + ` = ${score}/100`;

  return { score, margin, factors, formula };
}

const CARE_KEYWORDS = ["fabric", "wash", "cloth", "wood", "leather", "plant", "garment", "apparel", "shirt", "textile", "cast iron", "cutting board", "steel", "cushion", "rug"];
const CONSUMABLE_KEYWORDS = ["consumable", "refill", "subscription", "disposable", "single-use", "skincare", "supplement"];
const LOW_REPEAT_KEYWORDS = ["furniture", "storage", "organizer", "tool", "appliance", "decor", "cart", "shelf"];
const HOME_ORG_KEYWORDS = ["organiz", "storage", "declutter", "closet", "pantry", "shelf", "cart", "bin", "home"];
const SOCIAL_KEYWORDS = ["viral", "trend", "aesthetic", "satisfying", "transformation", "before and after", "hack"];

const stars = (n: number) => Math.round(clamp(n, 1, 5));

export function recommendProduct(input: ProductInput, score: number): Recommendation {
  const demo = clamp(input.demoFactor, 1, 10);
  const demoStars = stars(demo / 2);
  const audienceText = `${input.audience} ${input.category}`.toLowerCase();
  const productText = `${input.category} ${input.name} ${input.features}`.toLowerCase();
  const problemLen = input.problem.trim().length;
  const isFamily = FAMILY_KEYWORDS.some(k => hasKeyword(audienceText, k));
  const isSocial = SOCIAL_KEYWORDS.some(k => hasKeyword(productText, k));
  const isHomeOrg = HOME_ORG_KEYWORDS.some(k => hasKeyword(productText, k));
  const isConsumable = CONSUMABLE_KEYWORDS.some(k => hasKeyword(productText, k));
  const isLowRepeat = LOW_REPEAT_KEYWORDS.some(k => hasKeyword(productText, k));
  const isNonGift = NON_GIFT_KEYWORDS.some(k => hasKeyword(productText, k));

  const ratingList: { key: RecommendationKey; label: string; stars: number; detail: string }[] = [
    { key: "virality", label: "Virality", stars: stars(demoStars * 0.6 + (isSocial ? 2 : 0) + 1), detail: isSocial ? "Product has share-worthy, trend-friendly qualities" : "Based on visual demo strength" },
    { key: "impulseBuy", label: "Impulse Buy", stars: input.price <= 20 ? 5 : input.price <= 40 ? 4 : input.price <= 70 ? 3 : input.price <= 120 ? 2 : 1, detail: `$${input.price} price point` },
    { key: "problemSolver", label: "Problem Solver", stars: problemLen > 50 ? 5 : problemLen > 30 ? 4 : problemLen > 15 ? 3 : problemLen > 5 ? 2 : 1, detail: "Based on clarity of the problem statement" },
    { key: "giftability", label: "Giftability", stars: isNonGift ? 1 : (input.price >= 15 && input.price <= 150) ? 5 : 3, detail: isNonGift ? "Not a typical gift category" : "Price and category support gifting" },
    { key: "easyToDemonstrate", label: "Easy to Demonstrate", stars: demoStars, detail: `Demo factor ${demo}/10` },
    { key: "repeatPurchase", label: "Repeat Purchase Potential", stars: isConsumable ? 5 : isLowRepeat ? 2 : 3, detail: isConsumable ? "Consumable or replenishable product" : isLowRepeat ? "Durable, one-time purchase style product" : "Moderate repeat purchase likelihood" },
    { key: "familyAppeal", label: "Family Appeal", stars: isFamily ? 5 : 3, detail: isFamily ? "Audience is explicitly family/home oriented" : "Audience is not explicitly family-focused" },
    { key: "homeOrganizationFit", label: "Home Organization Fit", stars: isHomeOrg ? 5 : 2, detail: isHomeOrg ? "Matches home organization category/features" : "Not a home organization product" },
    { key: "socialMediaPotential", label: "Social Media Potential", stars: stars((demoStars + (isSocial ? 5 : 3)) / 2), detail: "Based on demo strength and trend-friendly features" },
    { key: "competitionLevel", label: "Competition Level", stars: input.competition === "low" ? 5 : input.competition === "medium" ? 3 : 1, detail: `${input.competition} competition selected` }
  ];

  const avg = ratingList.reduce((sum, r) => sum + r.stars, 0) / ratingList.length;
  const summary = score >= 80 && avg >= 4
    ? `Yes — ${input.name || "this product"} shows strong Fort Crazypants potential with high marks across margin, demo appeal, and giftability, so it's worth testing.`
    : score >= 65
    ? `This is a promising product worth a small test, though a few factors could be stronger before going all-in.`
    : score >= 50
    ? `This could work with some refinement, but it isn't a clear win yet — reconsider pricing, positioning, or audience fit.`
    : `This isn't a strong fit for Fort Crazypants right now — too many fundamentals need work to justify testing it.`;

  return { ratings: ratingList as Rating[], summary };
}

const psychPrice = (n: number) => Math.max(0.99, Math.floor(Math.max(n, 0)) + 0.99);
const psychRound = (n: number, ending = 0.99) => Math.max(ending, Math.floor(Math.max(n, 0)) + ending);
const round2 = (n: number) => Math.round(n * 100) / 100;

const ROOM_MAP: { keywords: string[]; room: string }[] = [
  { keywords: ["kitchen", "pantry", "cook"], room: "Kitchen" },
  { keywords: ["bath", "shower", "towel"], room: "Bathroom" },
  { keywords: ["office", "desk", "work"], room: "Home Office" },
  { keywords: ["closet", "wardrobe", "hanger"], room: "Closet" },
  { keywords: ["garage", "tool", "workshop"], room: "Garage" },
  { keywords: ["bed", "bedroom", "nightstand"], room: "Bedroom" },
  { keywords: ["living", "sofa", "couch", "decor"], room: "Living Room" },
  { keywords: ["outdoor", "patio", "garden", "yard"], room: "Outdoor/Patio" }
];

const CROSS_SELL_MAP: { keywords: string[]; ideas: string[] }[] = [
  { keywords: ["kitchen", "pantry", "cook"], ideas: ["Reusable storage containers", "Pantry labels", "Kitchen towels"] },
  { keywords: ["organiz", "storage", "closet", "bin"], ideas: ["Drawer dividers", "Label maker", "Extra storage bins"] },
  { keywords: ["bath", "shower"], ideas: ["Bath mats", "Shower caddies", "Bathroom organizers"] },
  { keywords: ["office", "desk"], ideas: ["Desk organizers", "Cable management kit", "Monitor stand"] },
  { keywords: ["outdoor", "garden", "patio"], ideas: ["Gardening gloves", "Planters", "Outdoor storage bin"] }
];

const STOPWORDS = new Set(["the", "and", "for", "with", "your", "that", "this", "from", "into", "have", "just", "make", "makes", "easy", "a", "an", "of", "to", "in", "on"]);

export function buildMerchandising(input: ProductInput, title: string, featureList: string[], score: number, margin: number, curatedCollections: CuratedCollection[] = []): Merchandising {
  const productText = `${input.category} ${input.name} ${input.features}`.toLowerCase();
  const audienceText = `${input.audience} ${input.category}`.toLowerCase();
  const isFamily = FAMILY_KEYWORDS.some(k => hasKeyword(audienceText, k));
  const isHomeOrg = HOME_ORG_KEYWORDS.some(k => hasKeyword(productText, k));
  const isSeasonal = SEASONAL_KEYWORDS.some(k => hasKeyword(productText, k));
  const isSocial = SOCIAL_KEYWORDS.some(k => hasKeyword(productText, k));

  const idealMarginPrice = input.cost > 0 ? input.cost / (1 - 0.6) : input.price;
  const recommendedPrice = psychPrice(Math.max(input.price, idealMarginPrice));
  let discountPrice = psychPrice(recommendedPrice * 0.82);
  if (discountPrice <= input.cost) discountPrice = psychPrice(input.cost * 1.3);

  const bundleOpportunities = [
    `"Buy 2, Save 15%" multi-pack of ${title}`,
    featureList[0] ? `Bundle with a ${featureList[0]} accessory kit for a complete set` : `Bundle with a complementary accessory for a complete set`,
    `Starter bundle: ${title} + care/cleaning kit for first-time buyers`
  ];

  const crossSellMatch = CROSS_SELL_MAP.find(c => c.keywords.some(k => hasKeyword(productText, k)));
  const crossSellIdeas = crossSellMatch ? crossSellMatch.ideas : ["Complementary accessory add-on", "Gift wrap upgrade", "Extended protection plan"];

  const targetCustomer = `${input.audience || "Busy households"} who struggle with ${input.problem || "everyday clutter and inefficiency"}`;

  const bestAgeGroup = /college|student/.test(audienceText) ? "18-24"
    : /teen/.test(audienceText) ? "13-19"
    : isFamily ? "30-45 (parents)"
    : /senior|elderly|retiree/.test(audienceText) ? "55+"
    : "25-44";

  const bestRoom = (ROOM_MAP.find(r => r.keywords.some(k => hasKeyword(productText, k)))?.room) || (isHomeOrg ? "Closet" : "Living Room");

  const bestSeason = isSeasonal
    ? (SEASONAL_KEYWORDS.find(k => hasKeyword(productText, k)) || "seasonal").replace(/\b\w/g, c => c.toUpperCase()) + " season"
    : isHomeOrg
    ? "Year-round, with a peak in January (New Year organization season)"
    : "Year-round";

  const demo = clamp(input.demoFactor, 1, 10);
  const bestSocialPlatform = demo >= 7 && input.price <= 50 ? "TikTok"
    : isHomeOrg ? "Pinterest"
    : isFamily ? "Facebook"
    : "Instagram";

  // Built from the product's actual category/collection, not individual words chopped out
  // of a feature sentence — "Outdoor Insect Control" was previously exploding into
  // unrelated single-word tags like #Outdoor #Insect #Control instead of describing the product.
  const hashtagPhrases = Array.from(new Set([...curatedCollections, input.category].filter(Boolean)));
  const suggestedHashtags = Array.from(new Set([
    ...hashtagPhrases.map(p => `#${p.replace(/[^a-zA-Z0-9]/g, "")}`),
    "#FortCrazypants",
    bestSocialPlatform === "TikTok" ? "#TikTokMadeMeBuyIt" : "#AmazonFinds",
    isHomeOrg ? "#HomeHacks" : "#ProblemSolved",
    isFamily ? "#FamilyFinds" : "#SmartShopping"
  ])).slice(0, 8);

  const keywordSource = `${title} ${input.category} ${input.audience} ${input.problem}`.toLowerCase()
    .split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const topKeywords = Array.from(new Set(keywordSource)).slice(0, 8);

  const ctaRecommendations = [
    `Shop now and simplify your ${bestRoom.toLowerCase()} today`,
    `Add to cart — Fort Score ${score}/100, ${margin}% margin, worth testing`,
    `Tag someone who needs ${title}`,
    `Limited stock — grab it before the next restock`
  ];

  return {
    recommendedPrice,
    discountPrice,
    bundleOpportunities,
    crossSellIdeas,
    targetCustomer,
    bestAgeGroup,
    bestRoom,
    bestSeason,
    bestSocialPlatform,
    suggestedHashtags,
    topKeywords,
    ctaRecommendations
  };
}

export function buildPricingEngine(input: ProductInput): PricingEngine {
  const cost = Math.max(input.cost, 0.01);

  const demo = clamp(input.demoFactor, 1, 10);
  let targetMarginPercent = input.competition === "low" ? 65 : input.competition === "medium" ? 58 : 50;
  if (demo >= 8) targetMarginPercent += 5;
  targetMarginPercent = clamp(targetMarginPercent, 45, 75);

  const floorPrice = cost * 1.1;

  const suggestedRetailRaw = cost / (1 - targetMarginPercent / 100);
  const suggestedRetail = psychRound(Math.max(suggestedRetailRaw, input.price, floorPrice));

  const premiumRetail = psychRound(suggestedRetail * 1.35);

  let flashSale = psychRound(suggestedRetail * 0.75);
  const flashSaleAdjusted = flashSale <= floorPrice;
  if (flashSaleAdjusted) flashSale = psychRound(floorPrice);

  let bogo = psychRound(suggestedRetail * 0.5);
  const bogoAdjusted = bogo <= floorPrice;
  if (bogoAdjusted) bogo = psychRound(floorPrice);

  let holidaySale = psychRound(suggestedRetail * 0.8, 0.95);
  const holidayAdjusted = holidaySale <= floorPrice;
  if (holidayAdjusted) holidaySale = psychRound(floorPrice, 0.95);

  const expectedProfit = round2(suggestedRetail - cost);

  const tiers: PricingTier[] = [
    {
      key: "suggestedRetail", label: "Suggested Retail", value: suggestedRetail, format: "currency",
      explanation: `Targets a ${targetMarginPercent}% margin over your $${cost.toFixed(2)} cost (${input.competition} competition${demo >= 8 ? ", boosted for strong demo appeal" : ""}), rounded to a psychologically attractive .99 price point.`
    },
    {
      key: "premiumRetail", label: "Premium Retail", value: premiumRetail, format: "currency",
      explanation: `35% above Suggested Retail — for a premium bundle, limited edition, or upsell variant, still ending in .99 to feel intentional rather than arbitrary.`
    },
    {
      key: "flashSale", label: "Flash Sale Price", value: flashSale, format: "currency",
      explanation: flashSaleAdjusted
        ? `Would normally be 25% off Suggested Retail, but that dipped below a safe 10% margin floor over cost, so it's held at the floor price instead.`
        : `25% off Suggested Retail — steep enough to drive urgency for a short-window flash sale while keeping margin above a 10% floor over cost.`
    },
    {
      key: "bogo", label: "BOGO Price", value: bogo, format: "currency",
      explanation: bogoAdjusted
        ? `The standard "second item 50% off" price would fall below a safe 10% margin floor over cost, so it's held at the floor price instead.`
        : `Price of the second unit in a "Buy One, Get One 50% Off" promo — half of Suggested Retail, while the first unit sells at full price.`
    },
    {
      key: "holidaySale", label: "Holiday Sale Price", value: holidaySale, format: "currency",
      explanation: holidayAdjusted
        ? `Would normally be 20% off Suggested Retail, but that dipped below a safe 10% margin floor over cost, so it's held at the floor price instead.`
        : `20% off Suggested Retail — a moderate seasonal discount, rounded to a .95 ending to visually distinguish sale pricing from everyday .99 pricing.`
    },
    {
      key: "targetMargin", label: "Target Margin", value: targetMarginPercent, format: "percent",
      explanation: `Baseline margin for ${input.competition} competition${demo >= 8 ? ", with a bonus for a highly demonstrable product" : ""}, capped between 45% and 75% to stay both profitable and market-realistic.`
    },
    {
      key: "expectedProfit", label: "Expected Profit", value: expectedProfit, format: "currency",
      explanation: `Suggested Retail ($${suggestedRetail.toFixed(2)}) minus cost ($${cost.toFixed(2)}) — the per-unit profit before ads, fees, and shipping.`
    }
  ];

  return { tiers };
}

// Amazon Affiliate products have no cost basis and no seller-set price — Amazon sets the
// price, and you earn a commission on whatever that is. The margin/retail-tier pricing
// engine above doesn't apply here at all (that's what made pricing look "way off" for
// affiliate products); this shows the real Amazon price and estimated commission instead.
const DEFAULT_AMAZON_COMMISSION_RATE = 3; // Amazon Associates' general "Standard" rate — actual rate varies 1-10% by category.

export function buildAffiliatePricing(input: ProductInput): PricingEngine {
  const price = Math.max(input.price, 0);
  const rate = DEFAULT_AMAZON_COMMISSION_RATE;
  const perSale = round2(price * (rate / 100));

  const tiers: PricingTier[] = [
    {
      key: "amazonPrice", label: "Amazon's Current Price", value: price, format: "currency",
      explanation: "Set by Amazon, not by you — this is the live price at the time you researched it and can change at any time. You don't control this."
    },
    {
      key: "commissionRate", label: "Est. Commission Rate", value: rate, format: "percent",
      explanation: "Amazon Associates' standard rate varies 1-10% by product category — check your Associates dashboard for the exact rate on this specific product."
    },
    {
      key: "commissionPerSale", label: "Est. Commission Per Sale", value: perSale, format: "currency",
      explanation: `At an estimated ${rate}% rate on the current $${price.toFixed(2)} price. Confirm your real rate in the Amazon Associates dashboard for accuracy.`
    },
    {
      key: "monthlyEarnings10", label: "Est. Earnings at 10 Sales/mo", value: round2(perSale * 10), format: "currency",
      explanation: "Illustrative only — actual earnings depend on your real commission rate and conversion volume."
    },
    {
      key: "monthlyEarnings50", label: "Est. Earnings at 50 Sales/mo", value: round2(perSale * 50), format: "currency",
      explanation: "Illustrative only — actual earnings depend on your real commission rate and conversion volume."
    }
  ];

  return { tiers };
}

const STYLE_SUFFIX = "Photorealistic, ultra-detailed, professional product photography, natural lighting, sharp focus, 8k resolution.";
const BASE_NEGATIVE = "no text, no watermark, no logos, no blurry details, no distorted hands, no extra limbs, no low resolution";

export function buildImagePrompts(input: ProductInput, title: string, featureList: string[]): ImagePrompt[] {
  const productText = `${input.category} ${input.name} ${input.features}`.toLowerCase();
  const featureText = featureList.slice(0, 3).join(", ") || "its key features";
  const room = (ROOM_MAP.find(r => r.keywords.some(k => hasKeyword(productText, k)))?.room) || "living room";
  const isFamily = FAMILY_KEYWORDS.some(k => hasKeyword(`${input.audience} ${input.category}`.toLowerCase(), k));

  const prompts: ImagePrompt[] = [
    {
      key: "lifestyle", label: "Lifestyle Image", aspectRatio: "4:5",
      prompt: `A high-resolution lifestyle photograph of "${title}" being used in a bright, modern ${room.toLowerCase()} by ${input.audience || "a real person"}. Candid, in-the-moment shot showing how it solves ${input.problem || "an everyday frustration"}. Highlight ${featureText}. Natural window light, warm inviting color palette, shallow depth of field, editorial lifestyle photography style, shot on a 50mm lens. ${STYLE_SUFFIX}`,
      negativePrompt: BASE_NEGATIVE
    },
    {
      key: "whiteBackground", label: "White Background Product", aspectRatio: "1:1",
      prompt: `Studio product photograph of "${title}" isolated on a pure white background (#FFFFFF), centered and fully in frame, soft even studio lighting with a subtle contact shadow beneath the product, clean e-commerce catalog style, showing ${featureText} clearly. ${STYLE_SUFFIX}`,
      negativePrompt: `${BASE_NEGATIVE}, no background texture, no props, no colored background`
    },
    {
      key: "pinterestPin", label: "Pinterest Pin", aspectRatio: "2:3",
      prompt: `Vertical Pinterest pin photo of "${title}" in an aspirational, bright and airy ${room.toLowerCase()} setting. Styled like a home/lifestyle blog hero image with soft natural light and a warm, inviting color grade. Leave clean negative space in the top third of the frame for a text overlay. ${STYLE_SUFFIX}`,
      negativePrompt: `${BASE_NEGATIVE}, no clutter, no busy background`
    },
    {
      key: "instagramSquare", label: "Instagram Square", aspectRatio: "1:1",
      prompt: `Instagram feed photo of "${title}" styled as a scroll-stopping hero shot on a clean, minimal surface with a trendy, on-brand color palette. Centered composition, soft natural light, showcasing ${featureText}. ${STYLE_SUFFIX}`,
      negativePrompt: BASE_NEGATIVE
    },
    {
      key: "instagramStory", label: "Instagram Story", aspectRatio: "9:16",
      prompt: `Vertical Instagram Story photo of "${title}", dynamic close-up angle with bold, vibrant color grading. Leave open negative space near the top and bottom of the frame for text and stickers. Energetic, mobile-first composition. ${STYLE_SUFFIX}`,
      negativePrompt: BASE_NEGATIVE
    },
    {
      key: "heroBanner", label: "Hero Banner", aspectRatio: "16:9",
      prompt: `Wide website hero banner image of "${title}" as the focal point, dramatic soft lighting, elegant background gradient in deep teal and gold tones, generous negative space on one side of the frame for a headline overlay. Premium, editorial e-commerce look. ${STYLE_SUFFIX}`,
      negativePrompt: `${BASE_NEGATIVE}, no busy background, no competing focal points`
    },
    {
      key: "websiteThumbnail", label: "Website Thumbnail", aspectRatio: "1:1",
      prompt: `Small, simple square thumbnail product photo of "${title}", centered subject, bright even lighting, minimal plain background, clean composition that stays legible at small sizes for a product grid. ${STYLE_SUFFIX}`,
      negativePrompt: `${BASE_NEGATIVE}, no busy background, no props`
    },
    {
      key: "holiday", label: "Holiday Version", aspectRatio: "4:5",
      prompt: `Festive holiday-themed photograph of "${title}" styled with warm seasonal decor — string lights, pine branches, and soft candlelight — in a cozy winter home setting. Rich red and gold accent colors, inviting gift-giving mood, product remains the clear focal point. ${STYLE_SUFFIX}`,
      negativePrompt: `${BASE_NEGATIVE}, no overpowering decor that hides the product`
    },
    {
      key: "family", label: "Family Version", aspectRatio: "4:5",
      prompt: `Warm lifestyle photograph of a ${isFamily ? "family" : "group"} using "${title}" together at home, genuine candid smiles and natural interaction, soft window light, cozy and welcoming ${room.toLowerCase()} setting, diverse and relatable family representation, editorial family-lifestyle photography style. ${STYLE_SUFFIX}`,
      negativePrompt: BASE_NEGATIVE
    }
  ];

  return prompts;
}

export function buildVideoPrompts(input: ProductInput, title: string, featureList: string[], score: number, margin: number): VideoPrompt[] {
  const problem = input.problem || "this everyday frustration";
  const audience = input.audience || "busy families";
  const feature1 = featureList[0] || "its standout feature";
  const feature2 = featureList[1] || "another key benefit";
  const topFeatures = featureList.slice(0, 3).join(", ") || "its core features";

  const prompts: VideoPrompt[] = [
    {
      key: "reel15", label: "15-Second Reel", duration: "15s",
      hook: `If ${problem} drives you crazy, watch this.`,
      scenes: [
        "0-3s: Hook — quick shot of the frustration caused by the problem, text overlay with the hook line",
        `3-10s: Fast-cut demo of ${title} solving it in one clear motion`,
        `10-15s: Freeze frame on the product with a "Fort Score ${score}/100" badge and CTA text overlay`
      ],
      voiceover: `If ${problem} drives you crazy, watch this. This is ${title} — and it fixes it instantly. Fort Score: ${score} out of 100. Link in bio.`,
      cta: "Tap to shop before it sells out."
    },
    {
      key: "reel30", label: "30-Second Reel", duration: "30s",
      hook: `If ${problem} drives you crazy, watch this.`,
      scenes: [
        "0-4s: Hook — show the frustration in a relatable, everyday setting",
        `4-9s: Problem — a beat longer on how ${audience} deal with this daily`,
        `9-20s: Demo — demonstrate ${title} in action, highlighting ${topFeatures}`,
        `20-25s: Proof — on-screen text showing Fort Score ${score}/100 and ${margin}% quality margin`,
        "25-30s: CTA — product hero shot with link/tap prompt"
      ],
      voiceover: `If ${problem} drives you crazy, watch this. ${audience} deal with this every day — until now. Meet ${title}. Watch how easily it handles ${feature1} and ${feature2}. It earned a Fort Score of ${score} out of 100. Tap the link to see the full find.`,
      cta: "Tap to see the full find at Fort Crazypants."
    },
    {
      key: "tiktok", label: "TikTok", duration: "15-21s",
      hook: `POV: you just found the fix for ${problem} 👀`,
      scenes: [
        "0-2s: Handheld, authentic hook shot with bold text overlay of the hook line",
        `2-6s: Quick reaction/discovery moment holding up ${title}`,
        `6-15s: Casual, unpolished demo showing ${feature1} and ${feature2} in real use`,
        "15-21s: Direct-to-camera close with a quick CTA line"
      ],
      voiceover: `POV: you just found the fix for ${problem}. This is ${title}, and it actually works. Watch this. [demo] Okay I'm obsessed. Link's in my bio, go grab it before it's gone.`,
      cta: "Link's in bio — go grab it before it's gone."
    },
    {
      key: "youtubeShort", label: "YouTube Short", duration: "45-60s",
      hook: `I tested ${title} so you don't have to.`,
      scenes: [
        "0-5s: Hook — creator talking to camera, holding the product",
        `5-15s: Unboxing/first look at ${title}, calling out ${topFeatures}`,
        `15-40s: Full demo walking through how it solves ${problem} for ${audience}`,
        `40-55s: Honest verdict — Fort Score ${score}/100, who it's best for, who should skip it`,
        "55-60s: CTA with subscribe prompt and link"
      ],
      voiceover: `I tested ${title} so you don't have to. Here's everything you need to know. [unboxing] [demo] My honest take: it earned a ${score} out of 100 on our Fort Score, and it's a great fit for ${audience}. Subscribe for more honest reviews — link to grab this one is below.`,
      cta: "Subscribe for more honest reviews — link below."
    },
    {
      key: "ugcAd", label: "UGC Ad", duration: "30-45s",
      hook: `I didn't think ${title} would actually work until I tried it.`,
      scenes: [
        "0-5s: Talking-head intro, casual home setting, no studio polish",
        `5-15s: Context — describing the daily struggle with ${problem}`,
        `15-30s: Using ${title} on camera, natural unscripted reaction`,
        "30-40s: Genuine testimonial close-up — why it's worth it",
        "40-45s: Text overlay with discount code / CTA"
      ],
      voiceover: `Okay so I didn't think ${title} would actually work until I tried it. I've been dealing with ${problem} for so long, and honestly this fixed it in like two minutes. [demo] If you're like me, you need this. I'll drop the link below.`,
      cta: "Use my link below to try it yourself."
    },
    {
      key: "demonstration", label: "Demonstration Video", duration: "30-45s",
      hook: `Here's exactly how ${title} works.`,
      scenes: [
        `0-5s: Setup shot — ${title} in its starting position/state`,
        `5-15s: Step 1 — demonstrate ${feature1} up close`,
        `15-25s: Step 2 — demonstrate ${feature2} up close`,
        "25-35s: Full end-to-end use, real time or light speed-ramp",
        "35-45s: Final result reveal with clean product hero shot"
      ],
      voiceover: `Here's exactly how ${title} works. Start with ${feature1} — simple as that. Then ${feature2} takes care of the rest. And that's it — ${problem}, solved.`,
      cta: "Get yours today and see the difference for yourself."
    },
    {
      key: "beforeAfter", label: "Before/After Video", duration: "15-20s",
      hook: `This is what ${problem} looked like before... and after.`,
      scenes: [
        "0-5s: 'Before' shot — the messy, frustrating starting state, text overlay 'BEFORE'",
        `5-8s: Quick transition — introducing ${title}`,
        "8-15s: 'After' shot — the clean, solved result, text overlay 'AFTER'",
        "15-20s: Side-by-side split screen of before vs. after with CTA text"
      ],
      voiceover: `This is what ${problem} looked like before. And this is after ${title}. No contest.`,
      cta: "See the transformation for yourself — shop now."
    },
    {
      key: "problemSolution", label: "Problem/Solution Video", duration: "20-30s",
      hook: `Struggling with ${problem}? Here's the fix.`,
      scenes: [
        `0-5s: Problem — relatable shot of ${audience} dealing with ${problem}`,
        "5-10s: Agitate — quick montage emphasizing how annoying/time-consuming it is",
        `10-15s: Introduce — reveal ${title} as the solution`,
        `15-25s: Solve — demonstrate ${title} resolving the problem, highlighting ${topFeatures}`,
        "25-30s: Resolution — happy end state with CTA overlay"
      ],
      voiceover: `Struggling with ${problem}? You're not alone — ${audience} deal with this constantly. Here's the fix: ${title}. [demo] Problem solved. Literally.`,
      cta: `Solve it today — tap to shop ${title}.`
    }
  ];

  return prompts;
}

export function buildSeoContent(
  input: ProductInput,
  title: string,
  handle: string,
  seoTitle: string,
  metaDescription: string,
  altText: string,
  faq: { question: string; answer: string }[],
  featureList: string[],
  collections: string[],
  crossSellIdeas: string[],
  blogTitle: string,
  score: number,
  margin: number
): SEOContent {
  const significantWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
  const focusKeyword = (significantWords.slice(0, 3).join(" ") || input.category || title).toLowerCase();

  const secondaryKeywords = Array.from(new Set([
    `best ${input.category || "everyday find"} for ${input.audience || "busy families"}`,
    `${title.toLowerCase()} review`,
    `${input.category || "home"} ideas`,
    input.problem ? `how to solve ${input.problem.toLowerCase()}` : `${focusKeyword} solutions`,
    `${focusKeyword} for home`
  ].filter(Boolean))).slice(0, 5);

  const schemaProductDescription = `${title} is a ${input.category || "practical"} product designed for ${input.audience || "busy households"}. It solves ${input.problem || "an everyday problem"} with ${featureList.slice(0, 3).join(", ") || "thoughtful design"}. Rated ${score}/100 on the Fort Score with an estimated ${margin}% margin, it ships in ${input.shippingDays} day${input.shippingDays === 1 ? "" : "s"}.`;

  const internalLinkingSuggestions = [
    `Link to the "${collections[0] || "New Finds"}" collection page from this product`,
    `Link from the blog post "${blogTitle}" back to this product page`,
    `Add a "Shop the ${input.category || "collection"}" link in the product description`,
    `Cross-link to a help/FAQ article about ${input.problem || "this problem"}`
  ];

  const relatedProducts = Array.from(new Set([
    ...crossSellIdeas.slice(0, 2),
    `Other ${input.category || "customer"} best sellers`,
    `${collections.find(c => c !== input.category) || "Best Sellers"} picks`
  ]));

  return {
    seoTitle,
    metaDescription,
    slug: handle,
    focusKeyword,
    secondaryKeywords,
    imageAltText: altText,
    schemaProductDescription,
    internalLinkingSuggestions,
    relatedProducts,
    faqs: faq
  };
}

export function generateProduct(input: ProductInput): GeneratedProduct {
  const { score, margin, factors: scoreFactors, formula: scoreFormula } = scoreProduct(input);
  const recommendation = recommendProduct(input, score);
  const title = input.name.trim() || "Clever Everyday Find";
  const handle = slugify(title);
  const featureList = input.features.split(/[,\n]/).map(v => v.trim()).filter(Boolean).slice(0, 6);
  const bullets = [
    `Makes ${input.problem || "everyday routines"} simpler`,
    ...featureList,
    `A smart pick for ${input.audience || "busy families"}`
  ].slice(0, 6);
  const benefits = [
    `Saves time by solving ${input.problem || "an everyday hassle"} in one step`,
    `Built for ${input.audience || "busy households"}, not just a niche crowd`,
    `Ships in ${input.shippingDays} day${input.shippingDays === 1 ? "" : "s"}, so the wait doesn't kill momentum`,
    `Priced to keep a healthy ${margin}% margin without feeling overpriced`,
    ...featureList.slice(0, 2).map(f => `${f} means less friction, more results`)
  ].slice(0, 6);
  const specifications = [
    `Category: ${input.category || "General merchandise"}`,
    `Price: $${input.price}`,
    `Estimated shipping time: ${input.shippingDays} day${input.shippingDays === 1 ? "" : "s"}`,
    `Competition level: ${input.competition}`,
    ...featureList.map(f => `Feature: ${f}`)
  ].slice(0, 8);
  const verdict = score >= 80 ? "Strong test candidate" : score >= 65 ? "Worth a small test" : score >= 50 ? "Needs refinement" : "Skip for now";
  const curatedCollections = detectCuratedCollections(`${input.category} ${title} ${input.features} ${input.problem}`);
  const tags = Array.from(new Set([input.category, "Fort Crazypants Find", "Problem Solver", input.audience, ...curatedCollections].filter(Boolean)));
  const collections = Array.from(new Set([
    ...curatedCollections,
    input.category || "New Finds",
    "Best Sellers",
    input.price <= 30 ? "Under $30" : input.price <= 75 ? "$30-$75" : "Premium Picks",
    input.shippingDays <= 7 ? "Fast Shipping" : "Worth the Wait"
  ].filter(Boolean)));
  const { ctaButtonText, ctaButtonUrl, disclosureText } = buildCtaAndDisclosure(input);
  // CTA button + disclosure are intentionally NOT baked in here — they're appended at
  // publish time instead (see /api/shopify/publish), so a later Settings-page disclosure
  // edit is still reflected in what actually gets published, without regenerating the product.
  const descriptionHtml = `<h2>Why you'll love it</h2><p>${title} helps ${input.audience || "busy households"} solve ${input.problem || "an everyday frustration"} without adding more work to the day.</p><ul>${bullets.map(b => `<li>${b}</li>`).join("")}</ul><p><strong>Fort Crazypants verdict:</strong> practical, giftable, and easy to understand at a glance.</p>`;
  const isCareApplicable = CARE_KEYWORDS.some(k => hasKeyword(`${input.category} ${input.name} ${input.features}`.toLowerCase(), k));
  const careInstructions = isCareApplicable
    ? `Spot clean with a soft, damp cloth. Avoid harsh chemicals and prolonged direct sunlight. Store in a dry area between uses to keep ${title} looking its best.`
    : "";
  const faq = [
    { question: `What makes ${title} different?`, answer: `It's built specifically to solve ${input.problem || "a common everyday problem"} for ${input.audience || "busy households"}, without extra complexity.` },
    { question: "How long does shipping take?", answer: `Estimated shipping time is ${input.shippingDays} day${input.shippingDays === 1 ? "" : "s"}.` },
    { question: "Who is this best for?", answer: `${input.audience || "Busy families and small-space organizers"} looking for a practical, easy-to-use solution.` },
    { question: "Is it worth the price?", answer: `At $${input.price}, it holds a ${margin}% margin while staying accessible — our Fort Score is ${score}/100 (${verdict}).` }
  ];
  const blogOutline = [
    `I. Introduction — the problem: ${input.problem || "an everyday frustration"} that ${input.audience || "busy families"} face`,
    `II. Meet ${title} — what it is and how it works`,
    `III. Key features: ${featureList.slice(0, 3).join(", ") || "core functionality"}`,
    `IV. Who it's best for: ${input.audience || "busy families"}`,
    `V. Fort Score breakdown: ${score}/100 (${verdict})`,
    `VI. Final verdict and call to action`
  ];

  const instagramCarousel = [
    `Slide 1 (Hook): Stop scrolling if ${input.problem || "this everyday problem"} sounds familiar.`,
    `Slide 2 (Problem): ${input.audience || "Busy households"} deal with ${input.problem || "everyday frustration"} more than they'd like to admit.`,
    `Slide 3 (Solution): Meet ${title} — ${featureList.slice(0, 2).join(" + ") || "a simple, practical fix"}.`,
    `Slide 4 (Proof): Fort Score ${score}/100 with a ${margin}% margin — a vetted, worthwhile pick.`,
    `Slide 5 (CTA): Tap the link to shop ${title} before it sells out.`
  ];

  const pinterestPinCopy = `${title}: A Clever Fix for ${input.problem || "Everyday Life"}\n\nMeet ${title}—a practical, family-friendly find that helps with ${input.problem || "everyday routines"}. Save this idea and see why it earned a Fort Score of ${score}/100.\n\n#FortCrazypants #HomeHacks #ProblemSolved`;

  const tiktokHook = `POV: you just found the fix for ${input.problem || "everyday chaos"} 👀`;
  const tiktokVoiceover = `[0-2s] ${tiktokHook}\n[2-6s] Show the problem — ${input.problem || "the everyday mess"} — in one quick shot.\n[6-12s] Introduce ${title}: "This is ${title}, and it ${featureList[0] ? `has ${featureList[0]}` : "actually works"}."\n[12-18s] Demo it in action — highlight ${featureList.slice(0, 2).join(" and ") || "the key feature"}.\n[18-22s] "It earned a Fort Score of ${score} out of 100."\n[22-25s] CTA: "Link's in bio — go grab it before it's gone."`;

  const reelScript15 = `HOOK (0-3s): If ${input.problem || "this everyday annoyance"} drives you crazy, watch this.\nDEMO (3-10s): Quick cut showing ${title} solving it in one motion.\nCTA (10-15s): Fort Score ${score}/100 — tap to shop.`;
  const reelScript30 = `HOOK (0-4s): If ${input.problem || "this everyday annoyance"} drives you crazy, watch this.\nPROBLEM (4-9s): Show the mess/frustration ${input.audience || "busy families"} deal with.\nDEMO (9-20s): Demonstrate ${title} in action, highlighting ${bullets.slice(0, 2).join(" and ")}.\nPROOF (20-25s): Fort Score ${score}/100 with an estimated ${margin}% gross margin.\nCTA (25-30s): Tap to see the full find at Fort Crazypants.`;

  const emailCampaign = `Subject: A clever fix for ${input.problem || "everyday chaos"}\nPreview: Fort Score ${score}/100 — see why we picked it.\n\nMeet ${title}.\n\nWe picked this one because it makes ${input.problem || "daily routines"} easier without being complicated. It is practical, easy to demonstrate, and useful for ${input.audience || "busy families"}.\n\nFort Score: ${score}/100\n\nTake a closer look and decide whether it belongs in your home.\n\nShop now →`;

  const smsPromotion = `Fort Crazypants: ${title} is here 🎉 Solve ${input.problem || "everyday clutter"} for just $${input.price}. Shop now: [link] Reply STOP to opt out.`;

  const googleShoppingDescription = `${title} — ${input.category || "practical everyday find"} designed for ${input.audience || "busy households"}. ${featureList.join(", ") || "Durable, easy to use"}. Solves ${input.problem || "a common everyday problem"}. Ships in ${input.shippingDays} day${input.shippingDays === 1 ? "" : "s"}.`;

  const blogArticle = `${title} is designed to help with ${input.problem || "a common everyday frustration"}. In this review, we look at who it is for, what makes it useful, and whether it deserves a place in your routine.\n\nBest for: ${input.audience || "busy families"}.\n\nKey benefits: ${bullets.join("; ")}.\n\nFeatures: ${featureList.join(", ") || "see product listing"}.\n\nOur Fort Score is ${score}/100. ${verdict}.\n\nBottom line: if you deal with ${input.problem || "this everyday frustration"}, ${title} is worth a closer look.`;

  const seoTitle = `${title} | Fort Crazypants`;
  const metaDescription = `Discover ${title}, a clever solution for ${input.problem || "everyday life"}. Shop practical, family-friendly finds from Fort Crazypants.`;
  const altText = `${title} product image showing its key features and everyday use`;
  const blogTitle = `Is ${title} Worth It? Our Fort Crazypants Review`;
  const merchandising = buildMerchandising(input, title, featureList, score, margin, curatedCollections);

  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    score,
    margin,
    verdict,
    title,
    handle,
    descriptionHtml,
    bullets,
    benefits,
    specifications,
    tags,
    collections,
    ctaButtonText,
    ctaButtonUrl,
    disclosureText,
    seoTitle,
    metaDescription,
    altText,
    pinterestTitle: `${title}: A Clever Fix for ${input.problem || "Everyday Life"}`,
    pinterestDescription: `Meet ${title}—a practical, family-friendly find that helps with ${input.problem || "everyday routines"}. Save this idea and see why it earned a Fort Score of ${score}/100.`,
    pinterestPinCopy,
    instagramCaption: `This is the kind of find that makes you say, “Why didn’t I know about this sooner?” 🤯\n\n${title} helps with ${input.problem || "everyday chaos"} and earned a Fort Score of ${score}/100.\n\nWould this make life easier at your house?\n\n#FortCrazypants #FamilyFinds #ProblemSolver #SmartShopping`,
    instagramCarousel,
    facebookPost: `A clever little upgrade for real life: ${title}. It helps ${input.audience || "busy families"} with ${input.problem || "everyday routines"}, and our Fort Score came in at ${score}/100. Would you try it?`,
    tiktokCaption: `POV: you just found the fix for ${input.problem || "everyday chaos"} 👀 ${title} #TikTokMadeMeBuyIt #FortCrazypants #ProblemSolved`,
    tiktokHook,
    tiktokVoiceover,
    reelScript: `HOOK: If ${input.problem || "this everyday annoyance"} drives you crazy, watch this.\nDEMO: Show the problem, then demonstrate ${title} in one clear motion.\nBENEFIT: Highlight ${bullets.slice(0, 2).join(" and ")}.\nPROOF: Fort Score ${score}/100 with an estimated ${margin}% gross margin.\nCTA: Tap to see the full find at Fort Crazypants.`,
    reelScript15,
    reelScript30,
    emailSubject: `A clever fix for ${input.problem || "everyday chaos"}`,
    emailBody: `Meet ${title}.\n\nWe picked this one because it makes ${input.problem || "daily routines"} easier without being complicated. It is practical, easy to demonstrate, and useful for ${input.audience || "busy families"}.\n\nFort Score: ${score}/100\n\nTake a closer look and decide whether it belongs in your home.`,
    emailCampaign,
    smsPromotion,
    googleShoppingDescription,
    faq,
    careInstructions,
    blogTitle,
    blogOutline,
    blogArticle,
    scoreFactors,
    scoreFormula,
    recommendation,
    merchandising,
    pricing: (input.isAffiliateProduct ?? input.productType === "amazon_affiliate") ? buildAffiliatePricing(input) : buildPricingEngine(input),
    imagePrompts: buildImagePrompts(input, title, featureList),
    videoPrompts: buildVideoPrompts(input, title, featureList, score, margin),
    seo: buildSeoContent(input, title, handle, seoTitle, metaDescription, altText, faq, featureList, collections, merchandising.crossSellIdeas, blogTitle, score, margin)
  };
}
