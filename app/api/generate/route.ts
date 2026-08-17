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
  isAffiliateProduct: z.coerce.boolean().optional(),
  merchant: z.string().default(""), affiliateNetwork: z.string().default(""),
  vendor: z.string().default("Fort Crazypants"), compareAtPrice: z.coerce.number().min(0).default(0), fcpVerdict: z.string().default(""),
  sourceDescription: z.string().default("")
}).transform(v => ({ ...v, isAffiliateProduct: v.isAffiliateProduct ?? v.productType === "amazon_affiliate" }))
  .refine(v => !v.isAffiliateProduct || /^https:\/\//i.test(v.affiliateUrl || v.amazonUrl || ""), {
    message: "Affiliate products require a valid https:// Affiliate URL.", path: ["affiliateUrl"]
  });

function cleanMarketplaceTitle(name: string): string {
  let title = name.replace(/\s+/g, " ").trim();
  const separators = [" - ", " – ", " — ", " | "];
  for (const sep of separators) {
    const i = title.indexOf(sep);
    if (i >= 24 && i <= 78) {
      title = title.slice(0, i).trim();
      break;
    }
  }
  const comma = title.indexOf(",");
  if (comma >= 24 && comma <= 78) title = title.slice(0, comma).trim();
  if (title.length > 72) {
    const cut = title.slice(0, 72);
    const space = cut.lastIndexOf(" ");
    title = (space > 28 ? cut.slice(0, space) : cut).trim();
  }
  return title;
}

function sentenceChunks(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\s*[•|]\s*/)
    .map(s => s.trim())
    .filter(s => s.length >= 18);
}

function polishWithoutAi<T extends {
  name: string; problem: string; features: string; audience: string; category: string; sourceDescription: string;
}>(input: T): T {
  const source = input.sourceDescription.trim();
  const sourceLower = source.toLowerCase();
  const name = cleanMarketplaceTitle(input.name);

  let audience = input.audience;
  if (/artist|diy|crafter|craft|engraving|woodwork|maker/.test(`${name} ${source}`.toLowerCase())) {
    audience = "artists, DIYers, crafters, and makers";
  }

  let problem = input.problem;
  if (!problem || /everyday inconvenience|everyday frustration|daily routine/i.test(problem)) {
    if (/engrav|customiz|personaliz/.test(`${name} ${source}`.toLowerCase())) {
      problem = "personalizing and engraving projects without needing bulky, complicated equipment";
    } else if (source) {
      const first = sentenceChunks(source)[0];
      if (first) problem = first.replace(/^buy\s+/i, "").replace(/[.!?]+$/, "");
    }
  }

  let features = input.features;
  const currentLooksGeneric = !features || /durable design|easy to use|compact footprint/i.test(features);
  if (source && currentLooksGeneric) {
    const chunks = sentenceChunks(source)
      .map(s => s.replace(/^buy\s+/i, "").replace(/[.!?]+$/, ""))
      .filter(s => !/^amazon/i.test(s))
      .slice(0, 5);
    if (chunks.length) features = chunks.join(", ");
  }

  let category = input.category;
  if (/engraving pen|engraver|engraving tool/i.test(`${name} ${source}`) && /general merchandise|home & lifestyle/i.test(category)) {
    category = "Craft Tools & Engraving";
  }

  return { ...input, name, problem, features, audience, category };
}

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const baseInput = polishWithoutAi(input);

    if (!isAiCopyEnabled()) {
      return NextResponse.json({ ...generateProduct(baseInput), aiCopyUsed: false });
    }

    const facts = await generateAIProductFacts(baseInput);
    const workingInput = facts ? { ...baseInput, ...facts } : baseInput;
    const deterministic = generateProduct(workingInput);

    const overrides = await generateAICopy(workingInput, deterministic);
    return NextResponse.json({ ...applyAiCopy(deterministic, overrides), aiCopyUsed: Boolean(facts || overrides) });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Invalid product data") }, { status: 400 });
  }
}
