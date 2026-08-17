import { NextResponse } from "next/server";

async function getAccessToken(domain: string): Promise<string> {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not configured.");
  }

  const r = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials"
    })
  });

  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error(data.error_description || "Could not obtain a Shopify access token.");
  }
  return data.access_token as string;
}

export async function POST(req: Request) {
  try {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const version = process.env.SHOPIFY_API_VERSION || "2025-10";
    if (!domain) {
      return NextResponse.json({ error: "Shopify credentials are not configured." }, { status: 503 });
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image files are supported." }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Image is too large. Use an image under 20 MB." }, { status: 400 });
    }

    const token = await getAccessToken(domain);
    const graphqlUrl = `https://${domain}/admin/api/${version}/graphql.json`;

    const mutation = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`;

    const targetResponse = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: [{
            filename: file.name || "product-image.jpg",
            mimeType: file.type || "image/jpeg",
            httpMethod: "POST",
            resource: "PRODUCT_IMAGE"
          }]
        }
      })
    });

    const targetData = await targetResponse.json();
    const payload = targetData?.data?.stagedUploadsCreate;
    if (!targetResponse.ok || targetData.errors || payload?.userErrors?.length) {
      return NextResponse.json({
        error: targetData.errors || payload?.userErrors || "Could not prepare Shopify image upload."
      }, { status: 400 });
    }

    const target = payload?.stagedTargets?.[0];
    if (!target?.url || !target?.resourceUrl) {
      return NextResponse.json({ error: "Shopify did not return an image upload target." }, { status: 502 });
    }

    const uploadForm = new FormData();
    for (const p of target.parameters || []) uploadForm.append(p.name, p.value);
    uploadForm.append("file", file, file.name || "product-image.jpg");

    const uploadResponse = await fetch(target.url, {
      method: "POST",
      body: uploadForm
    });

    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text().catch(() => "");
      return NextResponse.json({
        error: `Shopify image upload failed (${uploadResponse.status}).${detail ? ` ${detail.slice(0, 300)}` : ""}`
      }, { status: 502 });
    }

    return NextResponse.json({ resourceUrl: target.resourceUrl });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "Image upload failed."
    }, { status: 500 });
  }
}
