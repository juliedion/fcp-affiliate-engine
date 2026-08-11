import { describe, expect, it } from "vitest";
import { buildCtaAndDisclosure } from "./generator";
import { buildAffiliateMetafieldsPayload } from "./shopifyMetafields";
import { detectMerchantAndNetworkForTest, inferProductInput } from "./scrape";
import { AMAZON_ASSOCIATE_DISCLOSURE, GENERIC_AFFILIATE_DISCLOSURE, ProductInput } from "./types";

const baseInput: ProductInput = {
  url: "", name: "Test Product", cost: 10, price: 30, category: "Kitchen", audience: "busy families",
  problem: "clutter", features: "durable", shippingDays: 7, competition: "medium", demoFactor: 6,
  productType: "dropshipping", amazonUrl: "", affiliateUrl: "",
  isAffiliateProduct: false, merchant: "", affiliateNetwork: "", vendor: "Fort Crazypants",
  compareAtPrice: 0, fcpVerdict: "", sourceDescription: ""
};

describe("buildCtaAndDisclosure", () => {
  // Test case 1: Amazon Affiliate CTA/disclosure.
  it("uses 'Buy on Amazon' and the FTC-worded disclosure when productType is amazon_affiliate", () => {
    const result = buildCtaAndDisclosure({ ...baseInput, productType: "amazon_affiliate", amazonUrl: "https://amazon.com/dp/123", isAffiliateProduct: true, merchant: "Amazon" });
    expect(result.ctaButtonText).toBe("Buy on Amazon");
    expect(result.ctaButtonUrl).toBe("https://amazon.com/dp/123");
    expect(result.disclosureText).toBe(AMAZON_ASSOCIATE_DISCLOSURE);
  });

  // Test case 2: affiliateUrl takes priority over amazonUrl.
  it("prefers affiliateUrl over amazonUrl when both are set", () => {
    const result = buildCtaAndDisclosure({ ...baseInput, productType: "amazon_affiliate", isAffiliateProduct: true, merchant: "Amazon", amazonUrl: "https://amazon.com/dp/123", affiliateUrl: "https://amzn.to/abc" });
    expect(result.ctaButtonUrl).toBe("https://amzn.to/abc");
  });

  // Test case 3: non-affiliate products are unaffected — empty CTA URL/disclosure, per-type default CTA text.
  it("returns no URL/disclosure and the per-type default CTA for regular (non-affiliate) products", () => {
    const result = buildCtaAndDisclosure({ ...baseInput, productType: "dropshipping", isAffiliateProduct: false });
    expect(result.ctaButtonUrl).toBe("");
    expect(result.disclosureText).toBe("");
    expect(result.ctaButtonText).toBe("Add to Cart");
  });

  // Test case 4: generic (non-Amazon) affiliate merchant gets the merchant-mapped CTA label + generic disclosure.
  it("suggests the merchant-mapped CTA label and generic disclosure for a non-Amazon affiliate merchant", () => {
    const result = buildCtaAndDisclosure({ ...baseInput, isAffiliateProduct: true, merchant: "Walmart", affiliateUrl: "https://walmart.com/ip/123" });
    expect(result.ctaButtonText).toBe("Buy at Walmart");
    expect(result.disclosureText).toBe(GENERIC_AFFILIATE_DISCLOSURE);
    expect(result.ctaButtonUrl).toBe("https://walmart.com/ip/123");
  });

  // Test case 5: unrecognized merchant defaults to "View Product".
  it("defaults to 'View Product' for an unrecognized/blank merchant", () => {
    const result = buildCtaAndDisclosure({ ...baseInput, isAffiliateProduct: true, merchant: "SomeRandomShop", affiliateUrl: "https://example.com/x" });
    expect(result.ctaButtonText).toBe("View Product");
  });

  // Test case 6: every merchant in the mapping table produces its documented label.
  it("maps every documented merchant to its exact CTA label", () => {
    const cases: [string, string][] = [
      ["Amazon", "Buy on Amazon"], ["Walmart", "Buy at Walmart"], ["Target", "Buy at Target"],
      ["Mavely", "View Deal"], ["Impact", "Shop Now"], ["CJ", "Shop Now"], ["ShareASale", "Shop Now"],
      ["Awin", "Shop Now"], ["Rakuten", "Shop Now"], ["TikTok Shop", "Shop on TikTok"]
    ];
    for (const [merchant, expected] of cases) {
      const result = buildCtaAndDisclosure({ ...baseInput, isAffiliateProduct: true, merchant, affiliateUrl: "https://example.com/x" });
      expect(result.ctaButtonText).toBe(expected);
    }
  });

  // Test case 7: isAffiliateProduct defaults / derives correctly from productType for legacy data
  // (simulated here by omitting isAffiliateProduct entirely, as an old saved localStorage record would).
  it("falls back to productType === amazon_affiliate when isAffiliateProduct is undefined (legacy data)", () => {
    const legacy = { ...baseInput, productType: "amazon_affiliate" as const, amazonUrl: "https://amazon.com/dp/1" } as ProductInput;
    // @ts-expect-error simulating a legacy object that predates the isAffiliateProduct field
    delete legacy.isAffiliateProduct;
    const result = buildCtaAndDisclosure(legacy);
    expect(result.ctaButtonUrl).toBe("https://amazon.com/dp/1");
    expect(result.disclosureText).toBe(AMAZON_ASSOCIATE_DISCLOSURE);
  });
});

describe("buildAffiliateMetafieldsPayload", () => {
  // Test case 8: builds the exact metafield shape from the spec, filtering blanks.
  it("builds all six custom.* metafields for a fully-populated affiliate product", () => {
    const payload = buildAffiliateMetafieldsPayload("gid://shopify/Product/1", {
      isAffiliateProduct: true, affiliateUrl: "https://amazon.com/dp/1", affiliateNetwork: "Amazon Associates",
      merchant: "Amazon", ctaButtonText: "Buy on Amazon", fcpVerdict: "A great pick."
    });
    expect(payload).toHaveLength(6);
    expect(payload.find(f => f.key === "is_affiliate_product")).toEqual({ ownerId: "gid://shopify/Product/1", namespace: "custom", key: "is_affiliate_product", type: "boolean", value: "true" });
    expect(payload.find(f => f.key === "affiliate_url")?.value).toBe("https://amazon.com/dp/1");
    expect(payload.find(f => f.key === "fcp_verdict")?.type).toBe("multi_line_text_field");
  });

  it("only writes is_affiliate_product=false for a non-affiliate product, filtering out all blank affiliate fields", () => {
    const payload = buildAffiliateMetafieldsPayload("gid://shopify/Product/2", { isAffiliateProduct: false });
    expect(payload).toEqual([{ ownerId: "gid://shopify/Product/2", namespace: "custom", key: "is_affiliate_product", type: "boolean", value: "false" }]);
  });

  it("filters out undefined/null/empty-string fields even when affiliate", () => {
    const payload = buildAffiliateMetafieldsPayload("gid://shopify/Product/3", { isAffiliateProduct: true, affiliateUrl: "https://x.com", merchant: null, affiliateNetwork: undefined, ctaButtonText: "", fcpVerdict: "  has text  " });
    const keys = payload.map(f => f.key);
    expect(keys).toContain("affiliate_url");
    expect(keys).toContain("fcp_verdict");
    expect(keys).not.toContain("merchant");
    expect(keys).not.toContain("affiliate_network");
    expect(keys).not.toContain("cta_text");
  });
});

describe("merchant/network detection (lib/scrape.ts)", () => {
  it("detects Amazon", () => {
    expect(detectMerchantAndNetworkForTest("https://www.amazon.com/dp/B0ABC123")).toEqual({ isAffiliate: true, merchant: "Amazon", network: "Amazon Associates" });
  });
  it("detects amzn.to short links as Amazon", () => {
    expect(detectMerchantAndNetworkForTest("https://amzn.to/3xyz")).toEqual({ isAffiliate: true, merchant: "Amazon", network: "Amazon Associates" });
  });
  it("detects Walmart", () => {
    expect(detectMerchantAndNetworkForTest("https://www.walmart.com/ip/123456")).toEqual({ isAffiliate: true, merchant: "Walmart", network: "Impact" });
  });
  it("detects Target", () => {
    expect(detectMerchantAndNetworkForTest("https://www.target.com/p/thing/-/A-123")).toEqual({ isAffiliate: true, merchant: "Target", network: "Impact" });
  });
  it("detects a Mavely short link", () => {
    expect(detectMerchantAndNetworkForTest("https://mavely.app/abc123")).toEqual({ isAffiliate: true, merchant: "Mavely", network: "Mavely" });
  });
  it("detects a Mavely tracking param on a non-mavely domain", () => {
    expect(detectMerchantAndNetworkForTest("https://someshop.com/product/123?mavely_click_id=abc")).toEqual({ isAffiliate: true, merchant: "Mavely", network: "Mavely" });
  });
  it("does not flag an unrelated URL as affiliate", () => {
    expect(detectMerchantAndNetworkForTest("https://example.com/product/123")).toEqual({ isAffiliate: false, merchant: "", network: "" });
  });
});

describe("tracking-param preservation (lib/scrape.ts inferProductInput)", () => {
  // Test case: Amazon Associates tag= and other query params must never be stripped —
  // they're how the affiliate commission gets attributed.
  it("preserves Amazon tag= and other tracking params verbatim in the stored URL", () => {
    const url = "https://www.amazon.com/dp/B0ABC123?tag=fortcrazypants-20&linkCode=ll1&ref=as_li_ss_tl";
    const scraped = { title: "Test Product", price: 19.99, images: [], description: "A great product" };
    const result = inferProductInput(scraped, url);
    expect(result.input.url).toBe(url);
    expect(result.input.amazonUrl).toBe(url);
  });

  it("preserves a Mavely-style tracking param verbatim in the stored URL", () => {
    const url = "https://someshop.com/product/123?mavely_click_id=abc123&utm_source=mavely";
    const scraped = { title: "Test Product", price: 19.99, images: [], description: "desc" };
    const result = inferProductInput(scraped, url);
    expect(result.input.url).toBe(url);
    expect(result.input.affiliateUrl).toBe(url);
    expect(result.input.isAffiliateProduct).toBe(true);
    expect(result.input.merchant).toBe("Mavely");
  });

  it("sets isAffiliateProduct + merchant + vendor for a Walmart URL", () => {
    const url = "https://www.walmart.com/ip/thing/123456";
    const scraped = { title: "Thing", price: 9.99, images: [], description: "desc" };
    const result = inferProductInput(scraped, url);
    expect(result.input.isAffiliateProduct).toBe(true);
    expect(result.input.merchant).toBe("Walmart");
    expect(result.input.vendor).toBe("Walmart");
  });

  it("leaves a plain supplier URL as a non-affiliate dropshipping product", () => {
    const url = "https://supplier.example.com/product/123";
    const scraped = { title: "Thing", price: 9.99, images: [], description: "desc" };
    const result = inferProductInput(scraped, url);
    expect(result.input.isAffiliateProduct).toBe(false);
    expect(result.input.merchant).toBe("");
    expect(result.input.vendor).toBe("Fort Crazypants");
  });
});

describe("HTTPS validation for affiliate URLs", () => {
  const isValidAffiliateUrl = (url: string) => /^https:\/\//i.test(url);
  it("accepts https:// URLs", () => {
    expect(isValidAffiliateUrl("https://amazon.com/dp/1")).toBe(true);
  });
  it("rejects http:// (non-https) URLs", () => {
    expect(isValidAffiliateUrl("http://amazon.com/dp/1")).toBe(false);
  });
  it("rejects blank/missing URLs", () => {
    expect(isValidAffiliateUrl("")).toBe(false);
  });
});
