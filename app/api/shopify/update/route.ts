import { NextResponse } from "next/server";
import { buildAffiliateMetafieldsPayload } from "@/lib/shopifyMetafields";

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

// Updates a product that already exists in Shopify (e.g. imported by another app like
// Agora) with this app's AI-generated content — title, description, tags, extra images,
// and collections. Deliberately does NOT touch price, inventory, or variants: those are
// assumed to be owned/synced by whatever app originally created the product, and
// overwriting them here would fight that app's own sync instead of complementing it.
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
  const id = product.shopifyId;
  if (!id || typeof id !== "string") return NextResponse.json({ error: "Missing shopifyId of the product to update." }, { status: 400 });
  if (product.isAffiliateProduct && !/^https:\/\//i.test(String(product.affiliateUrl || product.amazonUrl || ""))) {
    return NextResponse.json({ error: "Affiliate products require a valid https:// Affiliate URL." }, { status: 400 });
  }

  // No CTA button baked into descriptionHtml — the storefront theme reads
  // custom.is_affiliate_product / custom.affiliate_url / custom.cta_text directly (see
  // theme/snippets/affiliate-buy-buttons.liquid). See app/api/shopify/publish/route.ts for
  // the full reasoning behind removing this.
  const descriptionHtml = product.descriptionHtml || "";

  const updateMutation = `mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id title } userErrors { field message } } }`;
  const updateVariables = { input: { id, title: product.title, descriptionHtml, tags: product.tags } };
  const updateResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: updateMutation, variables: updateVariables }) });
  const updateData = await updateResponse.json();
  if (!updateResponse.ok || updateData.errors || updateData.data?.productUpdate?.userErrors?.length) {
    return NextResponse.json({ error: updateData.errors || updateData.data?.productUpdate?.userErrors || "Update failed." }, { status: 400 });
  }
  const updated = updateData.data.productUpdate.product;

  // Add new images without touching whatever's already there.
  const imageUrls: string[] = Array.isArray(product.images) ? product.images.filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u)) : [];
  let mediaErrors: unknown = null;
  if (imageUrls.length > 0) {
    const mediaMutation = `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { media { id } mediaUserErrors { field message } } }`;
    const mediaVariables = { productId: id, media: imageUrls.slice(0, 10).map(src => ({ originalSource: src, mediaContentType: "IMAGE" })) };
    const mediaResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: mediaMutation, variables: mediaVariables }) });
    const mediaData = await mediaResponse.json();
    if (!mediaResponse.ok || mediaData.errors || mediaData.data?.productCreateMedia?.mediaUserErrors?.length) {
      mediaErrors = mediaData.errors || mediaData.data?.productCreateMedia?.mediaUserErrors;
    }
  }

  // Same collection-matching as a fresh publish — additive only, never removes existing
  // collection membership Agora (or anything else) already set up.
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

    for (const cid of matchedIds) {
      const addMutation = `mutation collectionAddProductsV2($id: ID!, $productIds: [ID!]!) { collectionAddProductsV2(id: $id, productIds: $productIds) { job { id } userErrors { field message } } }`;
      const addResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: addMutation, variables: { id: cid, productIds: [id] } }) });
      const addData = await addResponse.json();
      const title = existing.find(c => c.id === cid)?.title || cid;
      if (!addResponse.ok || addData.errors || addData.data?.collectionAddProductsV2?.userErrors?.length) {
        collectionErrors.push({ collection: title, error: addData.errors || addData.data?.collectionAddProductsV2?.userErrors });
      } else {
        collectionsAdded.push(title);
      }
    }
  } catch (e) {
    collectionErrors.push(e instanceof Error ? e.message : "Collection matching failed.");
  }

  let affiliateMetafieldsSet = false;
  let affiliateMetafieldsError: unknown = null;
  const affiliateMetafields = buildAffiliateMetafieldsPayload(id, product);
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

  return NextResponse.json({ ...updated, imagesAttached: imageUrls.length, mediaErrors, collectionsAdded, collectionErrors, affiliateMetafieldsSet, affiliateMetafieldsError });
}
