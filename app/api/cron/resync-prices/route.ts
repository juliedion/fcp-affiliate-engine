import { NextResponse } from "next/server";
import { scrapeProduct } from "@/lib/scrape";

export const maxDuration = 60;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

// This app has no database — Amazon Affiliate products carry their source URL as a Shopify
// metafield (set at publish time, see /api/shopify/publish), so Shopify itself is the only
// durable place this scheduled job can look to find out which products to re-check and
// what URL to re-check them against.
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2025-10";
  if (!domain) return NextResponse.json({ error: "Shopify credentials are not configured." }, { status: 503 });

  let token: string;
  try {
    token = await getAccessToken(domain);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not authenticate with Shopify." }, { status: 502 });
  }

  const graphql = async (query: string, variables: unknown) => {
    const r = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables })
    });
    return r.json();
  };

  const listQuery = `query($cursor: String) {
    products(first: 50, after: $cursor, query: "metafields.fort_crazypants.source_url:*") {
      nodes {
        id
        title
        metafield(namespace: "fort_crazypants", key: "source_url") { value }
        variants(first: 1) { nodes { id price } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  const results: { title: string; oldPrice: string; newPrice: string; updated: boolean; error?: string }[] = [];
  let cursor: string | null = null;
  let checked = 0;

  try {
    do {
      const listData = await graphql(listQuery, { cursor });
      const page = listData?.data?.products;
      if (!page) throw new Error(listData?.errors ? JSON.stringify(listData.errors) : "Could not list products.");

      for (const p of page.nodes) {
        const sourceUrl = p.metafield?.value;
        const variant = p.variants?.nodes?.[0];
        if (!sourceUrl || !variant) continue;
        checked++;

        try {
          await sleep(500); // be polite to Amazon — this runs on a schedule, not on demand
          const scraped = await scrapeProduct(sourceUrl);
          if (!scraped.price || scraped.price <= 0) {
            results.push({ title: p.title, oldPrice: variant.price, newPrice: "unavailable", updated: false });
            continue;
          }
          const newPrice = scraped.price.toFixed(2);
          if (newPrice === Number(variant.price).toFixed(2)) {
            results.push({ title: p.title, oldPrice: variant.price, newPrice, updated: false });
            continue;
          }
          const updateMutation = `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id price } userErrors { field message } } }`;
          const updateData = await graphql(updateMutation, { productId: p.id, variants: [{ id: variant.id, price: newPrice }] });
          const errs = updateData?.data?.productVariantsBulkUpdate?.userErrors;
          if (updateData.errors || errs?.length) {
            results.push({ title: p.title, oldPrice: variant.price, newPrice, updated: false, error: JSON.stringify(updateData.errors || errs) });
          } else {
            results.push({ title: p.title, oldPrice: variant.price, newPrice, updated: true });
          }
        } catch (e) {
          results.push({ title: p.title, oldPrice: variant.price, newPrice: "error", updated: false, error: e instanceof Error ? e.message : "Re-scrape failed." });
        }
      }

      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);

    return NextResponse.json({ checked, updated: results.filter(r => r.updated).length, results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Resync failed.", partialResults: results }, { status: 500 });
  }
}
