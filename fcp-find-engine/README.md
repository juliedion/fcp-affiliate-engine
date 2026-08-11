# Fort Crazypants OS

A deployable ecommerce merchandising application for scoring products, generating complete campaigns, saving candidates, exporting Shopify CSVs, and publishing draft products through Shopify's Admin API.

## Start locally

1. Install Node.js 20 or newer.
2. Open Terminal in this folder.
3. Run:

```bash
npm install
npm run dev
```

4. Open `http://localhost:3000`.

The application works immediately in demo mode without credentials.

## Enable Shopify publishing

1. In Shopify Admin, create a custom app with `write_products` access.
2. Install the app and copy its Admin API access token.
3. Copy `.env.example` to `.env.local`.
4. Add `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_ACCESS_TOKEN`.
5. Restart the application.

Products are intentionally created as DRAFTS.

## Add Supabase

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Add the Supabase URL and keys to `.env.local`.

The current interface uses browser storage so it works immediately. The schema is included for the next phase: authentication and cloud product storage.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Add the same environment variables in Vercel project settings.
4. Deploy.

## Included

- Product scoring engine
- Gross-margin estimate
- Shopify listing copy and SEO
- Instagram, Facebook, Pinterest, Reel, email, and blog content
- Saved product library
- Shopify-compatible CSV export
- Shopify Admin API draft publishing endpoint
- Supabase database schema
- Responsive dashboard
