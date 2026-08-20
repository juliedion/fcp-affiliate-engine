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

  if (product.isAffiliateProduct && !/^https:\/\//i.test(String(product.affiliateUrl || product.amazonUrl || ""))) {
    return NextResponse.json({ error: "Affiliate products require a valid https:// Affiliate URL." }, { status: 400 });
  }

  const descriptionHtml = product.descriptionHtml || "";
  const metafields = product.isAffiliateProduct && product.url
    ? [{ namespace: "fort_crazypants", key: "source_url", type: "url", value: String(product.url) }]
    : undefined;

  const variantOptions: { name: string; values: string[] }[] = Array.isArray(product.variantOptions)
    ? product.variantOptions.filter((o: unknown): o is { name: string; values: string[] } =>
        !!o && typeof o === "object" && typeof (o as { name?: unknown }).name === "string" && Array.isArray((o as { values?: unknown }).values) && (o as { values: unknown[] }).values.length > 0)
    : [];
  const variantCombos: { values: string[]; price: number }[] = Array.isArray(product.variants) ? product.variants : [];

  const mutation = `mutation productCreate($product: ProductCreateInput!) { productCreate(product: $product) { product { id title handle status } userErrors { field message } } }`;
  const baseHandle = String(product.handle || "product").replace(/-+$/g, "");

  async function tryCreate(handle: string) {
    const variables = {
      product: {
        title: product.title,
        handle,
        descriptionHtml,
        status: "DRAFT",
        productType: product.category,
        tags: product.tags,
        ...(metafields ? { metafields } : {}),
        ...(variantOptions.length > 0 ? { productOptions: variantOptions.map(o => ({ name: o.name, values: o.values.map(v => ({ name: v })) })) } : {})
      }
    };
    const response = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: mutation, variables })
    });
    const data = await response.json();
    return { response, data };
  }

  let createResult = await tryCreate(baseHandle);
  let handleUsed = baseHandle;

  // Shopify requires every product handle to be unique. Re-publishing a product with the
  // same generated slug used to fail completely. If that happens, automatically try a
  // clean numbered suffix instead of making the user rename it manually.
  const duplicateHandleError = (data: any) => {
    const errors = data?.data?.productCreate?.userErrors || [];
    return errors.some((e: any) =>
      Array.isArray(e?.field) && e.field.includes("handle") && /already in use/i.test(String(e?.message || ""))
    );
  };

  if (duplicateHandleError(createResult.data)) {
    for (let suffix = 2; suffix <= 20; suffix++) {
      const candidate = `${baseHandle}-${suffix}`;
      createResult = await tryCreate(candidate);
      handleUsed = candidate;
      if (!duplicateHandleError(createResult.data)) break;
    }
  }

  const response = createResult.response;
  const data = createResult.data;
  if (!response.ok || data.errors || data.data?.productCreate?.userErrors?.length) {
    return NextResponse.json({ error: data.errors || data.data?.productCreate?.userErrors || "Shopify publish failed" }, { status: 400 });
  }
  const created = data.data.productCreate.product;

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

  let inventoryLocked = false;
  let inventoryError: unknown = null;
  let priceSet = false;
  let variantsCreated = 0;
  const isAffiliate = Boolean(product.isAffiliateProduct);
  const variantQuery = `query($id: ID!) { product(id: $id) { variants(first: 1) { nodes { id } } } }`;
  const variantResponse = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query: variantQuery, variables: { id: created.id } }) });
  const variantData = await variantResponse.json();
  const variantId = variantData?.data?.product?.variants?.nodes?.[0]?.id;

  if (variantId) {
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

  return NextResponse.json({ ...created, handleUsed, imagesAttached: imageUrls.length, mediaErrors, inventoryLocked, inventoryError, priceSet, variantsCreated, collectionsAdded, collectionErrors, affiliateMetafieldsSet, affiliateMetafieldsError });
}
