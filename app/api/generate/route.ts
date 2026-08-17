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
  let title = name.replace(/^amazon(?:\.com)?\s*[:\-–—]\s*/i, "").replace(/\s+/g, " ").trim();

  const audienceBreak = title.search(/\s+for\s+(?:artists|diyers|crafters|makers|kids|adults|home|office|travel|camping)\b/i);
  if (audienceBreak >= 24) title = title.slice(0, audienceBreak).trim();

  const marketingBreak = title.search(/\s+(?:engrave|includes|with|featuring)\s+\d+/i);
  if (marketingBreak >= 24) title = title.slice(0, marketingBreak).trim();

  const separators = [",", " - ", " – ", " — ", " | "];
  for (const sep of separators) {
    const i = title.indexOf(sep);
    if (i >= 24 && i <= 85) {
      title = title.slice(0, i).trim();
      break;
    }
  }

  // Remove obvious Amazon keyword-stuffing tail while keeping a useful product type.
  title = title
    .replace(/\s+ultimate\s+cordless\s+portable\s+tool$/i, "")
    .replace(/\s+cordless\s+portable\s+tool$/i, "")
    .trim();

  if (title.length > 64) {
    const cut = title.slice(0, 64);
    const space = cut.lastIndexOf(" ");
    title = (space > 30 ? cut.slice(0, space) : cut).trim();
  }
  return title || name.trim();
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
  const combined = `${input.name} ${source} ${input.features}`.toLowerCase();
  const name = cleanMarketplaceTitle(input.name);
  const isEngraving = /engrav|engraver|engraving pen|rotary tool|etch|customiz|personaliz/.test(combined);

  let audience = input.audience;
  if (isEngraving) audience = "artists, DIYers, crafters, and makers";

  let problem = input.problem;
  if (isEngraving) {
    problem = "personalizing crafts and DIY projects without needing a bulky full-size engraving setup";
  } else if (!problem || /everyday inconvenience|everyday frustration|daily routine/i.test(problem)) {
    const first = sentenceChunks(source)[0];
    if (first) problem = first.replace(/^buy\s+/i, "").replace(/[.!?]+$/, "");
  }

  let features = input.features;
  if (isEngraving) {
    const facts: string[] = [];
    if (/50\+\s*surfaces/i.test(source)) facts.push("works across 50+ listed surfaces");
    if (/30\s*bits?/i.test(source)) facts.push("includes 30 engraving bits");
    if (/rechargeable/i.test(source)) facts.push("rechargeable cordless design");
    if (/beginner/i.test(source)) facts.push("beginner-friendly setup");
    if (/mastery guide/i.test(source)) facts.push("includes a mastery guide");
    features = facts.length ? facts.join(", ") : (source || input.features || "cordless engraving pen, interchangeable engraving bits, rechargeable design");
  } else if (source && (!features || /durable design|easy to use|compact footprint/i.test(features))) {
    const chunks = sentenceChunks(source)
      .map(s => s.replace(/^buy\s+/i, "").replace(/[.!?]+$/, ""))
      .filter(s => !/^amazon/i.test(s))
      .slice(0, 5);
    if (chunks.length) features = chunks.join(", ");
  }

  let category = input.category;
  if (isEngraving) category = "Craft Tools & Engraving";

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
