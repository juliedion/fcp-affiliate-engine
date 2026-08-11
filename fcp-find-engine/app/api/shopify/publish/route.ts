import { NextResponse } from "next/server";
import { buildAffiliateMetafieldsPayload } from "@/lib/shopifyMetafields";

// Custom apps created via the Shopify Dev Dashboard don't expose a static Admin API
// token in the UI — instead we exchange the app's Client ID/Secret for a short-lived
// access token via the client_credentials grant, scoped to the single installed store.
async function getAccessToken(domain: string): Promise<string> {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) throw new Error("SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not configured.");
  const r = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" })
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(data.error_description || "Could not obtain a Shopify access token.");
  return data.access_token as string;
}

export async function POST(req: Request) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2025-10";
  if (!domain) return NextResponse.json({ error: "Shopify credentials are not configured." }, { status: 503 });
  let token: string;
  try {
    token = await getAccessToken(domain);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not authenticate with Shopify." }, { status: 502 });
  }
  const product = await req.json();

  // Server-side affiliate validation — never publish an incomplete affiliate product,
  // regardless of what client-side validation already did (client validation can be bypassed).
  if (product.isAffiliateProduct && !/^https:\/\//i.test(String(product.affiliateUrl || product.amazonUrl || ""))) {
    return NextResponse.json({ error: "Affiliate products require a valid https:// Affiliate URL." }, { status: 400 });
  }

  // No CTA button is baked into descriptionHtml here — that was a workaround for themes
  // whose product template couldn't distinguish affiliate products (Shopify's own Buy button
  // would show "Sold Out" with no working purchase path). Now that the storefront theme
  // checks custom.is_affiliate_product / custom.affiliate_url / custom.cta_text directly
  // (see theme/snippets/affiliate-buy-buttons.liquid), the theme is the single source of
  // truth for the CTA — duplicating it here produced two visible buttons on the live page.
  // If a theme without that check is ever used, this would need to come back for that case.
  const descriptionHtml = product.descriptionHtml || "";
  // For Amazon Affiliate products, store the source Amazon URL as a metafield — this is
  // what lets the scheduled price-resync job (see /api/cron/resync-prices) find these
  // products later and know which URL to re-check, since this app has no database of its
  // own; Shopify's metafields are the only durable, server-visible place to keep it.
  const metafields = product.productType === "amazon_affiliate" && product.url
    ? [{ namespace: "fort_crazypants", key: "source_url", type: "url", value: String(product.url) }]
    : undefined;

  // Manual variant options (e.g. Color, Pack Size) — Amazon's real variant data isn't
  // reliably present in static HTML (same limitation as price), so these come from the
  // user typing them in rather than being scraped.
  const variantOptions: { name: string; values: string[] }[] = Array.isArray(product.variantOptions)
    ? product.variantOptions.filter((o: unknown): o is { name: string; values: string[] } =>
        !!o && typeof o === "object" && typeof (o as { name?: unknown }).name === "string" && Array.isArray((o as { values?: unknown }).values) && (o as { values: unknown[] }).values.length > 0)
    : [];
  const variantCombos: { values: string[]; price: number }[] = Array.isArray(product.variants) ? product.variants : [];

  const mutation = `mutation productCreate($product: ProductCreateInput!) { productCreate(product: $product) { product { id title handle status } userErrors { field message } } }`;
  const variables = {
    product: {
      title: product.title, handle: product.handle, descriptionHtml, status: "DRAFT", productType: product.category, tags: product.tags,
      ...(metafields ? { metafields } : {}),
      ...(variantOptions.length > 0 ? { productOptions: variantOptions.map(o => ({ name: o.name, values: o.values.map(v => ({ name: v })) })) } : {})
    }
  };
  const response = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: mutation, variables }) });
  const data = await response.json();
  if (!response.ok || data.errors || data.data?.productCreate?.userErrors?.length) return NextResponse.json({ error: data.errors || data.data?.productCreate?.userErrors || "Shopify publish failed" }, { status: 400 });
  const created = data.data.productCreate.product;

  // Attach images via a separate productCreateMedia call — Shopify's media API needs a
  // publicly-hosted image URL, not a raw data: URI (AI-generated images that never got
  // hosted anywhere can't be attached this way; only real scraped/hosted photos can).
  const imageUrls: string[] = Array.isArray(product.images) ? product.images.filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u)) : [];
  let mediaErrors: unknown = null;
  if (imageUrls.length > 0) {
    const mediaMutation = `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { media { id } mediaUserErrors { field message } } }`;
    const mediaVariables = { productId: created.id, media: imageUrls.slice(0, 10).map(src => ({ originalSource: src, mediaContentType: "IMAGE" })) };
    const mediaResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: mediaMutation, variables: mediaVariables }) });
    const mediaData = await mediaResponse.json();
    if (!mediaResponse.ok || mediaData.errors || mediaData.data?.productCreateMedia?.mediaUserErrors?.length) {
      mediaErrors = mediaData.errors || mediaData.data?.productCreateMedia?.mediaUserErrors;
    }
  }

  // productCreate leaves the default variant at $0.00 — it doesn't accept a price directly,
  // so it has to be set in a follow-up call. Bundled here with the Amazon Affiliate
  // inventory lock (same variant, one round-trip): Amazon Affiliate products have no real
  // inventory to sell through Shopify's own checkout — the whole point is customers click
  // through to Amazon instead. Shopify still shows a native Buy button on every product by
  // default, so this disables it: enabling inventory tracking on a brand-new variant
  // defaults its stock to 0, and inventoryPolicy DENY means "don't allow purchases when out
  // of stock" — together that turns the native button into "Sold out", leaving the CTA link
  // as the only working purchase path on the page.
  let inventoryLocked = false;
  let inventoryError: unknown = null;
  let priceSet = false;
  let variantsCreated = 0;
  const isAffiliate = product.productType === "amazon_affiliate";
  const variantQuery = `query($id: ID!) { product(id: $id) { variants(first: 1) { nodes { id } } } }`;
  const variantResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: variantQuery, variables: { id: created.id } }) });
  const variantData = await variantResponse.json();
  const variantId = variantData?.data?.product?.variants?.nodes?.[0]?.id;

  if (variantId) {
    // The default variant productCreate makes corresponds to the FIRST value of every
    // option — which is exactly variantCombos[0] as long as it was built in the same order
    // as variantOptions (the client does this). So variantCombos[0] gets applied to that
    // existing variant via bulkUpdate; every other combo needs a real new variant via
    // bulkCreate (productOptions alone does not generate the full combinatorial variant set).
    const defaultPrice = variantCombos[0]?.price ?? product.price;
    const variantInput: Record<string, unknown> = { id: variantId };
    if (typeof defaultPrice === "number" && defaultPrice > 0) variantInput.price = defaultPrice.toFixed(2);
    if (isAffiliate) { variantInput.inventoryPolicy = "DENY"; variantInput.inventoryItem = { tracked: true }; }

    const updateMutation = `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id price inventoryPolicy } userErrors { field message } } }`;
    const updateResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: updateMutation, variables: { productId: created.id, variants: [variantInput] } }) });
    const updateData = await updateResponse.json();
    if (!updateResponse.ok || updateData.errors || updateData.data?.productVariantsBulkUpdate?.userErrors?.length) {
      inventoryError = updateData.errors || updateData.data?.productVariantsBulkUpdate?.userErrors;
    } else {
      priceSet = typeof variantInput.price === "string";
      inventoryLocked = isAffiliate;
      variantsCreated = 1;
    }

    const remainingCombos = variantCombos.slice(1);
    if (remainingCombos.length > 0 && variantOptions.length > 0) {
      const newVariants = remainingCombos.map(combo => {
        const v: Record<string, unknown> = {
          optionValues: variantOptions.map((o, i) => ({ optionName: o.name, name: combo.values[i] }))
        };
        if (typeof combo.price === "number" && combo.price > 0) v.price = combo.price.toFixed(2);
        if (isAffiliate) { v.inventoryPolicy = "DENY"; v.inventoryItem = { tracked: true }; }
        return v;
      });
      const createMutation = `mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkCreate(productId: $productId, variants: $variants) { productVariants { id } userErrors { field message } } }`;
      const createResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: createMutation, variables: { productId: created.id, variants: newVariants } }) });
      const createData = await createResponse.json();
      if (!createResponse.ok || createData.errors || createData.data?.productVariantsBulkCreate?.userErrors?.length) {
        inventoryError = createData.errors || createData.data?.productVariantsBulkCreate?.userErrors;
      } else {
        variantsCreated += createData.data.productVariantsBulkCreate.productVariants.length;
      }
    }
  } else {
    inventoryError = "Could not find the default variant to update.";
  }

  // Products were never actually appearing on the homepage or any collection page — this
  // app generates collection *names* (e.g. "Outdoor & Garden") but never told Shopify to
  // add the product to a real Collection object, and this store's collections are all
  // Manual (not rule-based Smart collections), so tags alone don't populate them. This
  // fixes that: match our generated collection names/category against the store's real
  // collection titles by shared keywords, and always include "Home page" (the collection
  // that drives this store's homepage) so every published product is visible somewhere.
  const collectionsAdded: string[] = [];
  const collectionErrors: unknown[] = [];
  try {
    const collectionsQuery = `query { collections(first: 100) { nodes { id title } } }`;
    const collectionsResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: collectionsQuery, variables: {} }) });
    const collectionsData = await collectionsResponse.json();
    const existing: { id: string; title: string }[] = collectionsData?.data?.collections?.nodes ?? [];

    const STOPWORDS = new Set(["and", "the", "for", "with", "your", "best", "new", "finds", "picks", "wins", "fun"]);
    const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
    const productWords = new Set<string>([...(Array.isArray(product.collections) ? product.collections : []), product.category || ""].flatMap(words));

    const matchedIds = new Set<string>();
    for (const c of existing) {
      const titleWords = words(c.title);
      if (c.title.toLowerCase() === "home page" || titleWords.some(w => productWords.has(w))) matchedIds.add(c.id);
    }

    for (const id of matchedIds) {
      const addMutation = `mutation collectionAddProductsV2($id: ID!, $productIds: [ID!]!) { collectionAddProductsV2(id: $id, productIds: $productIds) { job { id } userErrors { field message } } }`;
      const addResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: addMutation, variables: { id, productIds: [created.id] } }) });
      const addData = await addResponse.json();
      const title = existing.find(c => c.id === id)?.title || id;
      if (!addResponse.ok || addData.errors || addData.data?.collectionAddProductsV2?.userErrors?.length) {
        collectionErrors.push({ collection: title, error: addData.errors || addData.data?.collectionAddProductsV2?.userErrors });
      } else {
        collectionsAdded.push(title);
      }
    }
  } catch (e) {
    collectionErrors.push(e instanceof Error ? e.message : "Collection matching failed.");
  }

  // Affiliate metafields (custom.is_affiliate_product / affiliate_url / affiliate_network /
  // merchant / cta_text / fcp_verdict) — set via a dedicated metafieldsSet call, additive to
  // the fort_crazypants.source_url metafield set inline at creation above. Requires the
  // `custom.*` metafield definitions to already exist in the store (see
  // scripts/setup-affiliate-metafields.mjs) — metafieldsSet will still succeed without
  // definitions (Shopify allows undefined metafields), so this is not a hard dependency.
  let affiliateMetafieldsSet = false;
  let affiliateMetafieldsError: unknown = null;
  const affiliateMetafields = buildAffiliateMetafieldsPayload(created.id, product);
  if (affiliateMetafields.length > 0) {
    const metafieldsSetMutation = `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id key } userErrors { field message } } }`;
    const metafieldsSetResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: metafieldsSetMutation, variables: { metafields: affiliateMetafields } }) });
    const metafieldsSetData = await metafieldsSetResponse.json();
    if (!metafieldsSetResponse.ok || metafieldsSetData.errors || metafieldsSetData.data?.metafieldsSet?.userErrors?.length) {
      affiliateMetafieldsError = metafieldsSetData.errors || metafieldsSetData.data?.metafieldsSet?.userErrors;
    } else {
      affiliateMetafieldsSet = true;
    }
  }

  return NextResponse.json({ ...created, imagesAttached: imageUrls.length, mediaErrors, inventoryLocked, inventoryError, priceSet, variantsCreated, collectionsAdded, collectionErrors, affiliateMetafieldsSet, affiliateMetafieldsError });
}
