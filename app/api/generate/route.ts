import { NextResponse } from "next/server";
import { z } from "zod";
import { generateProduct } from "@/lib/generator";
import { formatApiError } from "@/lib/apiError";
import { applyAiCopy, generateAICopy, generateAIProductFacts, isAiCopyEnabled } from "@/lib/aiCopywriter";

const schema = z.object({
  url: z.string().default(""), name: z.string().min(2), cost: z.coerce.number().min(0), price: z.coerce.number().positive(),
  category: z.string().default("Home & Lifestyle"), audience: z.string().default("busy families"), problem: z.string().default(""),
  features: z.string().default(""), shippingDays: z.coerce.number().min(0).default(7),
  competition: z.enum(["low", "medium", "high"]).default("medium"), demoFactor: z.coerce.number().min(1).max(10).default(7),
  productType: z.enum(["amazon_affiliate", "dropshipping", "wholesale", "private_label"]).default("dropshipping"),
  amazonUrl: z.string().default(""), affiliateUrl: z.string().default(""),
  // Generic affiliate-product fields (see lib/types.ts). isAffiliateProduct defaults to
  // (productType === "amazon_affiliate") when the caller doesn't send it, for backward
  // compatibility with any existing client/localStorage payload that predates this field.
  isAffiliateProduct: z.coerce.boolean().optional(),
  merchant: z.string().default(""), affiliateNetwork: z.string().default(""),
  vendor: z.string().default("Fort Crazypants"), compareAtPrice: z.coerce.number().min(0).default(0), fcpVerdict: z.string().default(""),
  sourceDescription: z.string().default("")
}).transform(v => ({ ...v, isAffiliateProduct: v.isAffiliateProduct ?? v.productType === "amazon_affiliate" }))
  .refine(v => !v.isAffiliateProduct || /^https:\/\//i.test(v.affiliateUrl || v.amazonUrl || ""), {
    message: "Affiliate products require a valid https:// Affiliate URL.", path: ["affiliateUrl"]
  });

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());

    if (!isAiCopyEnabled()) return NextResponse.json({ ...generateProduct(input), aiCopyUsed: false });

    // Polish problem/features BEFORE generation — they seed a large amount of deterministic
    // copy (bullets, video scripts, social captions), so this has to happen first to keep
    // everything downstream consistent (see lib/aiCopywriter.ts generateAIProductFacts).
    const facts = await generateAIProductFacts(input);
    const workingInput = facts ? { ...input, ...facts } : input;
    const deterministic = generateProduct(workingInput);

    const overrides = await generateAICopy(workingInput, deterministic);
    return NextResponse.json({ ...applyAiCopy(deterministic, overrides), aiCopyUsed: Boolean(facts || overrides) });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Invalid product data") }, { status: 400 });
  }
}
