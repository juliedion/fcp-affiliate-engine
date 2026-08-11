// Affiliate-product metafield support. Additive to the existing, unrelated
// `fort_crazypants.source_url` metafield used by the price-resync cron (see
// app/api/shopify/publish/route.ts) — everything here lives under the `custom` namespace
// only, and never touches metafields this app doesn't own.

export type AffiliateMetafieldSource = {
  isAffiliateProduct?: boolean;
  affiliateUrl?: string | null;
  affiliateNetwork?: string | null;
  merchant?: string | null;
  ctaButtonText?: string | null;
  fcpVerdict?: string | null;
};

export type ShopifyMetafieldInput = {
  ownerId: string;
  namespace: "custom";
  key: string;
  type: string;
  value: string;
};

// Builds the `custom.*` metafield payload for a product. Only emits fields that have a
// real, non-empty value — Shopify's metafieldsSet rejects/ignores empty strings for some
// types anyway, and there's no reason to write empty affiliate fields onto a regular,
// non-affiliate Shopify product. is_affiliate_product itself is always written (true or
// false) so the storefront Liquid can reliably branch on its presence.
export function buildAffiliateMetafieldsPayload(ownerId: string, product: AffiliateMetafieldSource): ShopifyMetafieldInput[] {
  const isAffiliate = Boolean(product.isAffiliateProduct);
  const candidates: ShopifyMetafieldInput[] = [
    { ownerId, namespace: "custom", key: "is_affiliate_product", type: "boolean", value: String(isAffiliate) },
    { ownerId, namespace: "custom", key: "affiliate_url", type: "url", value: product.affiliateUrl ?? "" },
    { ownerId, namespace: "custom", key: "affiliate_network", type: "single_line_text_field", value: product.affiliateNetwork ?? "" },
    { ownerId, namespace: "custom", key: "merchant", type: "single_line_text_field", value: product.merchant ?? "" },
    { ownerId, namespace: "custom", key: "cta_text", type: "single_line_text_field", value: product.ctaButtonText ?? "" },
    { ownerId, namespace: "custom", key: "fcp_verdict", type: "multi_line_text_field", value: product.fcpVerdict ?? "" }
  ];

  return candidates.filter(f => {
    if (f.key === "is_affiliate_product") return true;
    if (!isAffiliate) return false; // don't write blank affiliate fields onto a non-affiliate product
    return f.value !== undefined && f.value !== null && f.value !== "";
  });
}

const METAFIELD_DEFINITIONS: { key: string; name: string; type: string; description: string }[] = [
  { key: "is_affiliate_product", name: "Is Affiliate Product", type: "boolean", description: "Whether this product links out to an external merchant instead of using Shopify checkout." },
  { key: "affiliate_url", name: "Affiliate URL", type: "url", description: "The external (affiliate-tagged) purchase URL." },
  { key: "affiliate_network", name: "Affiliate Network", type: "single_line_text_field", description: "e.g. Amazon Associates, Impact, CJ, ShareASale, Awin, Rakuten, Mavely." },
  { key: "merchant", name: "Merchant", type: "single_line_text_field", description: "e.g. Amazon, Walmart, Target, Mavely." },
  { key: "cta_text", name: "CTA Text", type: "single_line_text_field", description: "Button label shown in place of Add to Cart, e.g. \"Buy on Amazon\"." },
  { key: "fcp_verdict", name: "Fort Crazypants Verdict", type: "multi_line_text_field", description: "Free-text marketing blurb shown near the affiliate CTA." }
];

export type ShopifyGraphQLClient = (query: string, variables: Record<string, unknown>) => Promise<{ data?: unknown; errors?: unknown }>;

// Idempotent: checks metafieldDefinitions for the `custom` namespace on Product first, and
// only creates the ones that don't already exist. Safe to call on every deploy / setup run.
export async function ensureAffiliateMetafieldDefinitions(graphql: ShopifyGraphQLClient): Promise<{ created: string[]; skipped: string[]; errors: { key: string; error: unknown }[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors: { key: string; error: unknown }[] = [];

  const listQuery = `query { metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") { nodes { key } } }`;
  const listResult = await graphql(listQuery, {});
  const existingKeys = new Set(
    ((listResult.data as { metafieldDefinitions?: { nodes?: { key: string }[] } } | undefined)?.metafieldDefinitions?.nodes ?? []).map(n => n.key)
  );

  for (const def of METAFIELD_DEFINITIONS) {
    if (existingKeys.has(def.key)) { skipped.push(def.key); continue; }
    const mutation = `mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id key }
        userErrors { field message code }
      }
    }`;
    const variables = {
      definition: {
        name: def.name,
        namespace: "custom",
        key: def.key,
        description: def.description,
        type: def.type,
        ownerType: "PRODUCT"
      }
    };
    try {
      const result = await graphql(mutation, variables);
      const userErrors = (result.data as { metafieldDefinitionCreate?: { userErrors?: unknown[] } } | undefined)?.metafieldDefinitionCreate?.userErrors;
      if (result.errors || (userErrors && userErrors.length > 0)) {
        errors.push({ key: def.key, error: result.errors || userErrors });
      } else {
        created.push(def.key);
      }
    } catch (e) {
      errors.push({ key: def.key, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { created, skipped, errors };
}
