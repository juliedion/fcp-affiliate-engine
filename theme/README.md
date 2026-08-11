# Affiliate Product Support — Theme Files

These files are **not deployed automatically** — this repo has no live Shopify theme
connection (confirmed: zero `.liquid` files exist anywhere else in this codebase). Paste
them manually into your theme via the Shopify Admin's Online Store > Themes > Edit code.

## Files

- `snippets/affiliate-buy-buttons.liquid` — drop-in replacement for wherever your theme
  calls `{% render 'buy-buttons', ... %}`. Renders the normal Add to Cart flow unchanged for
  regular products; renders an external CTA + merchant badge + disclosure instead for
  affiliate products. It does **not** duplicate your theme's buy-buttons internals — it calls
  through to the real `buy-buttons` snippet for the non-affiliate path.
- `assets/affiliate-buy-button.css` — styles for `.affiliate-buy-button`, `.affiliate-merchant-badge`,
  `.affiliate-disclosure` (full width on mobile, visible focus outline, WCAG-contrast colors).
- `assets/affiliate-click-tracking.js` — listens for clicks on `[data-affiliate-click]` and
  beacons an `affiliate_product_click` event to the Merch Manager app.

## Install steps (Online Store 2.0 theme)

1. **Metafield definitions** — run `node scripts/setup-affiliate-metafields.mjs` from this
   repo once (needs `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` in your
   env or `.env.local`). This registers the `custom.*` Product metafield definitions so they
   show up nicely in the Shopify Admin UI. Publishing/updating a product from this app will
   also *set* metafield values even before you run this script (Shopify allows values on
   undefined metafields), but running it first is the intended order.

2. **Add the snippet** — in Admin, go to Online Store > Themes > your theme > Edit code >
   Snippets > Add a new snippet, name it `affiliate-buy-buttons`, and paste the contents of
   `theme/snippets/affiliate-buy-buttons.liquid`.

3. **Wire it in** — find where your product template renders the buy buttons. In most
   Online Store 2.0 themes (Dawn and its descendants) this is inside
   `sections/main-product.liquid`, in a block that calls:
   ```liquid
   {% render 'buy-buttons', block: block, product: product, product_form_id: product_form_id, section: section %}
   ```
   Change that single line to:
   ```liquid
   {% render 'affiliate-buy-buttons', block: block, product: product, product_form_id: product_form_id, section: section %}
   ```
   (Search the theme code for `'buy-buttons'` if the exact file differs — themes vary.)

4. **Add the CSS** — Assets > Add a new asset > upload/paste `affiliate-buy-button.css`.
   Then in `layout/theme.liquid`, inside `<head>`, add:
   ```liquid
   {{ 'affiliate-buy-button.css' | asset_url | stylesheet_tag }}
   ```

5. **Add the click-tracking script** — Assets > Add a new asset > upload/paste
   `affiliate-click-tracking.js`. Then near the end of `<body>` in `layout/theme.liquid`, add:
   ```liquid
   <script>window.FORT_CRAZYPANTS_APP_ORIGIN = "https://your-merch-manager-app.vercel.app";</script>
   <script src="{{ 'affiliate-click-tracking.js' | asset_url }}" defer></script>
   ```
   Set `FORT_CRAZYPANTS_APP_ORIGIN` to wherever this app is deployed (skip the inline script
   tag if the theme happens to share an origin with the app, which it normally won't).

6. **Preview before publishing** — use the theme editor's preview, or a duplicate/unpublished
   theme, before pushing to your live theme.

## What this does NOT touch

- Regular (non-affiliate) products: zero changes to Add to Cart, checkout, inventory
  messaging, subscriptions, or local pickup. The `{% else %}` branch in the snippet calls
  straight through to your existing `buy-buttons` snippet.
- Any metafield outside the `custom.is_affiliate_product` / `custom.affiliate_url` /
  `custom.affiliate_network` / `custom.merchant` / `custom.cta_text` / `custom.fcp_verdict`
  set — this app never reads or writes any other metafield namespace/key.

## Manual QA checklist (browser/DOM-level — not covered by this repo's vitest suite)

This repo has no e2e/browser test runner and no live theme, so the following must be
verified by hand once the snippet is pasted into a real (ideally unpublished/preview) theme:

- [ ] A regular (non-affiliate) product still shows Add to Cart / Buy It Now and completes
      checkout normally — no visual or functional regression.
- [ ] An affiliate product does **not** show Add to Cart, Buy It Now, the quantity selector,
      local pickup availability, inventory messaging ("X in stock" / "Sold out"), or
      subscription/selling-plan options.
- [ ] An affiliate product shows the CTA button with the correct merchant-specific label
      (e.g. "Buy on Amazon"), opens the affiliate URL in a **new tab**, and the link has
      `rel="nofollow sponsored noopener"`.
- [ ] The merchant badge ("Available at {merchant}") appears when `merchant` is set, and is
      absent entirely when blank — not rendered as an empty pill.
- [ ] The disclosure paragraph renders below the CTA, uses the FTC-required Amazon wording
      specifically for merchant "Amazon", and the generic wording for every other merchant.
- [ ] Clicking the CTA button fires a request to `/api/analytics/affiliate-click` (check the
      Network tab) with `productId`, `productTitle`, `merchant`, `affiliateNetwork`,
      `destinationUrl`, `timestamp` — and the click does not appear delayed before navigating.
- [ ] Tab to the CTA button with keyboard only — a visible focus outline appears, and Enter
      activates it.
- [ ] Run the CTA button's text/background color pairing through a contrast checker (target
      WCAG AA, 4.5:1 for normal text) if you change `#1a5f4a` / `#fff` in the CSS.
