import { NextResponse } from "next/server";
import { z } from "zod";
import { formatApiError } from "@/lib/apiError";

const schema = z.object({ id: z.string().min(1) });

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

// Flips a draft product to Active. Note: this app's Shopify access token only has the
// write_products scope, not write_publications — so this changes status but can't
// guarantee the product is published to the Online Store sales channel specifically.
// If it still doesn't appear on the storefront after this, check Sales Channels manually.
export async function POST(req: Request) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2025-10";
  if (!domain) return NextResponse.json({ error: "Shopify credentials are not configured." }, { status: 503 });
  try {
    const { id } = schema.parse(await req.json());
    const token = await getAccessToken(domain);
    const mutation = `mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id status } userErrors { field message } } }`;
    const r = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: mutation, variables: { input: { id, status: "ACTIVE" } } })
    });
    const data = await r.json();
    if (!r.ok || data.errors || data.data?.productUpdate?.userErrors?.length) {
      return NextResponse.json({ error: data.errors || data.data?.productUpdate?.userErrors || "Could not activate product." }, { status: 400 });
    }
    return NextResponse.json(data.data.productUpdate.product);
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Could not activate product.") }, { status: 400 });
  }
}
