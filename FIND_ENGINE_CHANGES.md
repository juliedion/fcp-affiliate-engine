# Fort Crazypants Find Engine — V1

This version refactors Product Studio toward an affiliate-first workflow without replacing the existing backend.

## What changed
- Rebranded Product Studio as the **Fort Crazypants Find Engine**
- New workflow language: **Add a Find → Make It Crazypants → Publish**
- Affiliate products are now the default starting mode
- Default audience/category now starts with family-friendly Find positioning
- Added curated Find categories:
  - Crazy Finds
  - Road Trip Rescues
  - Kid Approved
  - Dog Stuff
  - Backyard Fun
  - Home Hacks
  - Under $25
  - Gifts
  - Travel
- Renamed affiliate UI copy to make the retailer-link model clearer
- Added a dedicated **Ready to Publish** card showing:
  - primary product image
  - title
  - category
  - quick take
  - top benefits
  - FCP verdict
  - retailer/network
  - external CTA
  - Publish Find / Create Social / Create Article actions
- Preserved the existing Shopify, AI generation, social, image/video, SEO, checklist, and affiliate logic.

## Important
I was unable to complete a full `npm run build` validation inside the ChatGPT container because npm dependency installation stalled in the environment. The source changes are packaged cleanly without `node_modules`.

On your machine, run:

```bash
npm install
npm run build
npm run dev
```

If the build reports a TypeScript/JSX issue, paste the error into ChatGPT and it can be patched quickly.
