# Affiliate Product Support

Adds generic affiliate-product support (Amazon, Walmart, Target, Mavely, and any other
merchant/network) on top of the pre-existing Amazon-only affiliate mechanism.

## Env vars

**No new env vars.** This feature reuses the existing Shopify Admin API credentials
(`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_API_VERSION`).

## 1. Register the metafield definitions (one-time, per store)

```
node scripts/setup-affiliate-metafields.mjs
```

Idempotent — checks for existing `custom.*` Product metafield definitions first and only
creates what's missing. Needs the Shopify env vars above, either already exported or in a
`.env.local` file at the repo root.

This registers:

| namespace.key | type |
|---|---|
| `custom.is_affiliate_product` | boolean |
| `custom.affiliate_url` | url |
| `custom.affiliate_network` | single_line_text_field |
| `custom.merchant` | single_line_text_field |
| `custom.cta_text` | single_line_text_field |
| `custom.fcp_verdict` | multi_line_text_field |

Publishing/updating a product from Product Studio sets these values via `metafieldsSet`
regardless of whether the definitions exist yet (Shopify allows values on undefined
metafields) — running the script first is just the intended, cleaner order, and gives you
nice field names/descriptions in the Shopify Admin UI.

## 2. Paste the theme files

Full instructions: [`theme/README.md`](../theme/README.md). Summary: paste
`theme/snippets/affiliate-buy-buttons.liquid`, `theme/assets/affiliate-buy-button.css`, and
`theme/assets/affiliate-click-tracking.js` into your live theme via Admin > Online Store >
Themes > Edit code, then swap your product template's `{% render 'buy-buttons', ... %}` call
for `{% render 'affiliate-buy-buttons', ... %}`.

## 3. Manual QA checklist (browser/DOM-level — vitest can't cover these)

See the full checklist in [`theme/README.md`](../theme/README.md#manual-qa-checklist-browserdom-level--not-covered-by-this-repos-vitest-suite).
In short: Add to Cart hidden/shown correctly, CTA opens a new tab with correct `rel`
attributes, merchant badge shows/hides correctly, disclosure wording is correct per
merchant, click tracking fires, keyboard focus is visible.

## 4. End-to-end walkthrough: Shark ChillPill via an Amazon Associates URL

1. In Product Studio, paste an Amazon Associates URL for the Shark ChillPill (or any real
   Amazon product) into the URL field, e.g. `https://www.amazon.com/dp/XXXXXXXXXX?tag=your-associates-id-20`.
   Research runs automatically — confirm the scraped title/price/images populate, and that
   the **Product type** pill auto-selects "Amazon Affiliate" (existing behavior, unchanged).
2. Confirm **Affiliate Product** is checked automatically once Product type = Amazon
   Affiliate, with **Merchant** defaulted to "Amazon". If it isn't checked automatically in
   your build, check it manually and set Merchant to "Amazon".
3. Confirm the **Affiliate URL** field shows your associates-tagged URL, including the
   `?tag=...` parameter verbatim (this app never strips tracking params — see
   `lib/affiliate.test.ts`'s tracking-param-preservation tests).
4. Click **Generate**. In the output area, confirm:
   - The CTA preview shows "Buy on Amazon".
   - The disclosure text below it reads "As an Amazon Associate, I earn from qualifying
     purchases." (exact FTC-required wording).
   - A merchant badge "Available at Amazon" appears above the CTA.
5. Optionally add a **Fort Crazypants Verdict** blurb (e.g. "The ChillPill is a genuinely
   clever stocking-stuffer — kept our drinks cold on three separate road trips.").
6. Click **Publish draft**. This requires live Shopify credentials — this app's own test
   environment has none, so this step must be run against your real store. Confirm in the
   response message:
   - The draft product is created.
   - `inventoryLocked: true` (Shopify's native Buy button is disabled — existing mechanism,
     unchanged).
   - `affiliateMetafieldsSet: true` (new — confirms the six `custom.*` metafields were written).
7. In the Shopify Admin, open the new product > Metafields, and confirm `custom.*` values
   match what you entered (is_affiliate_product = true, affiliate_url = your tagged URL,
   merchant = Amazon, cta_text = "Buy on Amazon", fcp_verdict = your blurb).
8. Once the theme files (step 2 above) are pasted into your live theme, view the product's
   live storefront page and walk through the full manual QA checklist in step 3.

## Architecture notes

### `isAffiliateProduct` vs. the existing `productType` enum

This is the single most significant judgment call in this feature. Before this change, "is
this product an affiliate product" was inferred *purely* from `productType === "amazon_affiliate"`
— a single enum value that conflates two independent concepts: the product's *business model*
(own inventory vs. dropship vs. wholesale vs. private label vs. affiliate) and whether it
*links out to an external merchant instead of using Shopify checkout*.

That conflation only worked because Amazon was the only affiliate merchant supported. Adding
Walmart/Target/Mavely/etc. affiliate flows without inventing four more ProductType enum
values (`walmart_affiliate`, `target_affiliate`, ...) requires decoupling "is affiliate" from
"business model." So:

- **`ProductType`** (`amazon_affiliate` | `dropshipping` | `wholesale` | `private_label`) is
  left completely unchanged — it's still a useful, orthogonal classification (e.g. for
  reporting/filtering), and `amazon_affiliate` remains a valid, meaningful value.
- **`isAffiliateProduct: boolean`** is the new, independent field that actually drives the
  affiliate UX (external CTA instead of Shopify checkout, metafields, storefront branching).
  It **defaults to `productType === "amazon_affiliate"`** everywhere a `ProductInput` is
  constructed (Product Studio's initial state, `lib/scrape.ts`'s Amazon detection, Winning
  Products handoff payloads, the `/api/generate` zod schema's `.transform()`), so every
  existing saved/generated Amazon Affiliate product behaves identically to before this
  change with zero migration needed.
- Going forward, `isAffiliateProduct` can be `true` for a `dropshipping`-typed product (a
  Walmart/Target/Mavely affiliate product) — `productType` for those stays `"dropshipping"`
  since there's no better existing enum value, and `isAffiliateProduct` is the field that
  actually matters for behavior. `buildCtaAndDisclosure()` in `lib/generator.ts` reads
  `isAffiliateProduct` first, falling back to the `productType` check only when
  `isAffiliateProduct` is `undefined` (legacy data safety net).

### Field-name reconciliation

| Spec name | Field actually used | Notes |
|---|---|---|
| `price` | `ProductInput.price` | already existed |
| `productType` (Shopify category) | `ProductInput.category` | already existed; NOT the same as the existing `ProductType` enum field, which is also literally named `productType` — see judgment call above |
| `vendor` | `ProductInput.vendor` (new) | did not previously exist as a field; publish route previously hardcoded `"Fort Crazypants"` inline — now defaults the same way but is editable/overridable (e.g. set to the merchant name for affiliate products) |
| `collections`, `tags` | `GeneratedProduct.collections` / `.tags` | already existed |
| `seoTitle`, `seoDescription`, `imageAltText` | `GeneratedProduct.seoTitle`, `.metaDescription`, `.altText` (also mirrored in `.seo.seoTitle/.metaDescription/.imageAltText`) | already existed |
| `ctaText` | `GeneratedProduct.ctaButtonText` | already existed, reused as-is |
| `isAffiliateProduct` | `ProductInput.isAffiliateProduct` (new) | see judgment call above |
| `merchant` | `ProductInput.merchant` (new) | did not exist |
| `affiliateNetwork` | `ProductInput.affiliateNetwork` (new) | did not exist |
| `fcpVerdict` | `ProductInput.fcpVerdict` (new) | distinct from the existing auto score-derived `GeneratedProduct.verdict` ("Strong test candidate" etc.) — this is a separate, free-text, user-editable marketing blurb |
| `compareAtPrice` | `ProductInput.compareAtPrice` (new) | did not exist; stored but not yet wired into a Shopify variant field (see "Known gaps" below) |

### Disclosure precedence

`ProductSettings.disclosureText` remains the single editable global override (unchanged —
still settable in Settings, still injected into `descriptionHtml` at publish time). When a
product doesn't have that override applied (or for the storefront Liquid default), the
*default* disclosure text is chosen per-merchant:

- Merchant "Amazon" (or legacy `productType === "amazon_affiliate"`) → the exact FTC-required
  wording, `AMAZON_ASSOCIATE_DISCLOSURE`, unchanged from before this feature.
- Any other affiliate merchant → the new generic wording, `GENERIC_AFFILIATE_DISCLOSURE`
  ("We may earn a commission if you purchase through this link.").
- Non-affiliate products → no disclosure at all (unchanged).

### No database changes

Per the existing architecture (Shopify is the source of truth; there's no server-side
product database in this app, only browser `localStorage`), this feature adds **no**
Supabase schema. All new fields live in Shopify Product metafields (namespace `custom`) and
in the browser-local `ProductInput`/`GeneratedProduct` records, exactly like every other
product field in this app already does.

### Known gaps / deliberately deferred

- `compareAtPrice` is captured in the UI and type system but is **not yet wired into** the
  Shopify `productVariantsBulkUpdate` call in `app/api/shopify/publish/route.ts` (which
  currently only sets `price`). Wiring it up is a small, isolated follow-up
  (`variantInput.compareAtPrice = ...`) — left out of this pass to keep the already-large
  diff reviewable; flagged here explicitly rather than silently omitted.
- The click-tracking endpoint (`/api/analytics/affiliate-click`) only logs structured JSON to
  Vercel's function logs — there's no analytics database in this app to persist to (see
  "No database changes" above). Swap the `console.log` for a real provider when one exists.
- Storefront/browser-level test cases (Add to Cart hidden/visible, link opens new tab, `rel`
  attributes present) are **not** covered by the vitest suite — this repo has no e2e/browser
  test runner and no live theme connection to test against. They're listed as a manual QA
  checklist in `theme/README.md` instead of being faked with meaningless assertions.
