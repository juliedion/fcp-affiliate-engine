#!/usr/bin/env node
// One-off setup script: registers the `custom.*` Shopify Product metafield definitions
// used by affiliate-product support (see lib/shopifyMetafields.ts / docs/affiliate-products.md).
// Idempotent — safe to run multiple times; it checks-then-creates, never duplicates.
//
// Usage:
//   node scripts/setup-affiliate-metafields.mjs
//
// Requires the same env vars this app already uses for live Shopify access:
//   SHOPIFY_STORE_DOMAIN, SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_API_VERSION (optional)
// Load them from .env.local if present (no extra dependency — a tiny manual parser).

import { readFileSync, existsSync } from "node:fs";

function loadDotEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvLocal();

const domain = process.env.SHOPIFY_STORE_DOMAIN;
const clientId = process.env.SHOPIFY_API_KEY;
const clientSecret = process.env.SHOPIFY_API_SECRET;
const version = process.env.SHOPIFY_API_VERSION || "2025-10";

if (!domain || !clientId || !clientSecret) {
  console.error("Missing SHOPIFY_STORE_DOMAIN / SHOPIFY_API_KEY / SHOPIFY_API_SECRET — set them in .env.local or your shell environment.");
  process.exit(1);
}

async function getAccessToken() {
  const r = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" })
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(data.error_description || "Could not obtain a Shopify access token.");
  return data.access_token;
}

const METAFIELD_DEFINITIONS = [
  { key: "is_affiliate_product", name: "Is Affiliate Product", type: "boolean", description: "Whether this product links out to an external merchant instead of using Shopify checkout." },
  { key: "affiliate_url", name: "Affiliate URL", type: "url", description: "The external (affiliate-tagged) purchase URL." },
  { key: "affiliate_network", name: "Affiliate Network", type: "single_line_text_field", description: "e.g. Amazon Associates, Impact, CJ, ShareASale, Awin, Rakuten, Mavely." },
  { key: "merchant", name: "Merchant", type: "single_line_text_field", description: "e.g. Amazon, Walmart, Target, Mavely." },
  { key: "cta_text", name: "CTA Text", type: "single_line_text_field", description: "Button label shown in place of Add to Cart, e.g. \"Buy on Amazon\"." },
  { key: "fcp_verdict", name: "Fort Crazypants Verdict", type: "multi_line_text_field", description: "Free-text marketing blurb shown near the affiliate CTA." }
];

async function main() {
  const token = await getAccessToken();
  const graphql = async (query, variables) => {
    const r = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables })
    });
    return r.json();
  };

  const listResult = await graphql(`query { metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") { nodes { key } } }`, {});
  const existingKeys = new Set((listResult.data?.metafieldDefinitions?.nodes ?? []).map(n => n.key));

  for (const def of METAFIELD_DEFINITIONS) {
    if (existingKeys.has(def.key)) {
      console.log(`skip  custom.${def.key} (already exists)`);
      continue;
    }
    const result = await graphql(
      `mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) { createdDefinition { id key } userErrors { field message code } }
      }`,
      { definition: { name: def.name, namespace: "custom", key: def.key, description: def.description, type: def.type, ownerType: "PRODUCT" } }
    );
    const userErrors = result.data?.metafieldDefinitionCreate?.userErrors;
    if (result.errors || (userErrors && userErrors.length > 0)) {
      console.error(`FAIL  custom.${def.key}`, JSON.stringify(result.errors || userErrors));
    } else {
      console.log(`OK    custom.${def.key} created`);
    }
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
