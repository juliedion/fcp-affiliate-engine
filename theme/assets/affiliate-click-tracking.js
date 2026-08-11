/**
 * affiliate-click-tracking.js
 * Paste into a new theme asset (Assets > Add a new asset > affiliate-click-tracking.js) and
 * load it near the end of theme.liquid's <body> (defer is fine, this only wires up a click
 * listener):
 *   <script src="{{ 'affiliate-click-tracking.js' | asset_url }}" defer></script>
 *
 * Fires `affiliate_product_click` to /api/analytics/affiliate-click on Fort Crazypants OS
 * (the Merch Manager app), which currently just structured-logs it (see
 * app/api/analytics/affiliate-click/route.ts) — swap for a real analytics provider later
 * without changing this script's contract.
 *
 * Never delays navigation: the link's normal target="_blank" click behavior is left
 * completely alone; this only observes the click, it doesn't intercept or preventDefault it.
 */
(function () {
  // Same-origin as the Merch Manager app if this theme is served from the connected Shopify
  // store's custom domain path, OR set window.FORT_CRAZYPANTS_APP_ORIGIN in theme.liquid if
  // the analytics endpoint lives on a different origin (typical: Vercel app domain).
  var ENDPOINT = (window.FORT_CRAZYPANTS_APP_ORIGIN || "") + "/api/analytics/affiliate-click";

  function trackClick(el) {
    var payload = {
      productId: el.getAttribute("data-product-id") || "",
      productTitle: el.getAttribute("data-product-title") || "",
      merchant: el.getAttribute("data-merchant") || "",
      affiliateNetwork: el.getAttribute("data-affiliate-network") || "",
      destinationUrl: el.getAttribute("data-destination-url") || el.href,
      timestamp: new Date().toISOString()
    };

    var body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(ENDPOINT, blob);
      return;
    }

    // Fallback for browsers without sendBeacon — keepalive lets the request survive the
    // page navigating away to the affiliate destination.
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {
      /* best-effort only — never block or alert on a tracking failure */
    });
  }

  document.addEventListener("click", function (event) {
    var el = event.target.closest ? event.target.closest("[data-affiliate-click]") : null;
    if (!el) return;
    trackClick(el);
    // Deliberately no preventDefault/setTimeout-delay — the target="_blank" link proceeds immediately.
  });
})();
