import { NextResponse } from "next/server";
import { z } from "zod";
import { formatApiError } from "@/lib/apiError";

const schema = z.object({ q: z.string().min(1) });

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

// Lets the user find a product already created by another app (e.g. Agora) and select it
// for content-only updates via /api/shopify/update, instead of always creating a new
// (duplicate) product.
export async function GET(req: Request) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2025-10";
  if (!domain) return NextResponse.json({ error: "Shopify credentials are not configured." }, { status: 503 });
  try {
    const { q } = schema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const token = await getAccessToken(domain);
    const query = `query($q: String!) { products(first: 10, query: $q) { nodes { id title handle status featuredImage { url } } } }`;
    const r = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables: { q: `title:*${q}*` } })
    });
    const data = await r.json();
    if (!r.ok || data.errors) return NextResponse.json({ error: data.errors || "Search failed." }, { status: 400 });
    return NextResponse.json({ results: data.data.products.nodes });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Search failed.") }, { status: 400 });
  }
}
