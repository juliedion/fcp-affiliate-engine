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

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function capitalizeSentence(value: string): string {
  const clean = value.trim().replace(/[.!?]+$/, "");
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

function buildSpecificDescriptionHtml(input: {
  name: string; problem: string; features: string; audience: string; category: string; fcpVerdict?: string;
}): string {
  const name = escapeHtml(input.name.trim());
  const audience = input.audience.trim() || "shoppers";
  const problem = capitalizeSentence(input.problem || "making the task simpler");

  const featureItems = input.features
    .split(/[,\n•|]+/)
    .map(x => x.trim().replace(/[.!?]+$/, ""))
    .filter(x => x.length > 2)
    .filter((x, i, arr) => arr.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i)
    .slice(0, 6);

  const bullets = featureItems.length
    ? featureItems.map(x => `<li>${escapeHtml(capitalizeSentence(x))}.</li>`).join("")
    : `<li>Designed specifically for ${escapeHtml(input.category.toLowerCase())} use.</li>`;

  const lead = `<p><strong>${name}</strong> is a practical pick for ${escapeHtml(audience)} who want help with ${escapeHtml(problem.charAt(0).toLowerCase() + problem.slice(1))}. Instead of generic product-page filler, this listing focuses on the actual details that make this product useful.</p>`;

  const benefit = featureItems.length
    ? `<p>What stands out most is ${escapeHtml(featureItems.slice(0, 3).join(", "))}. Those are the details that make it easier to understand exactly what you're getting and where it fits into your routine.</p>`
    : "";

  const verdict = input.fcpVerdict?.trim()
    ? escapeHtml(input.fcpVerdict.trim())
    : `If ${escapeHtml(input.problem || "this is a problem you deal with")}, this is the kind of find worth a closer look.`;

  return `<h2>Why You'll Love It</h2>${lead}<ul>${bullets}</ul>${benefit}<p><strong>Fort Crazypants verdict:</strong> ${verdict}</p>`;
}

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const baseInput = polishWithoutAi(input);

    // Always replace the old template description with a product-specific rewrite first.
    // If OpenAI is configured, the AI rewrite below can improve this further. If OpenAI is
    // missing or the request fails, shoppers still get a real rewritten description rather
    // than the generic "helps busy households / everyday inconvenience" template.
    const deterministicBase = generateProduct(baseInput);
    const deterministic = {
      ...deterministicBase,
      descriptionHtml: buildSpecificDescriptionHtml(baseInput)
    };

    if (!isAiCopyEnabled()) {
      return NextResponse.json({ ...deterministic, aiCopyUsed: false, descriptionRewriteUsed: true });
    }

    const facts = await generateAIProductFacts(baseInput);
    const workingInput = facts ? { ...baseInput, ...facts } : baseInput;
    const regeneratedBase = generateProduct(workingInput);
    const regenerated = {
      ...regeneratedBase,
      descriptionHtml: buildSpecificDescriptionHtml(workingInput)
    };

    const overrides = await generateAICopy(workingInput, regenerated);
    return NextResponse.json({ ...applyAiCopy(regenerated, overrides), aiCopyUsed: Boolean(facts || overrides), descriptionRewriteUsed: true });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Invalid product data") }, { status: 400 });
  }
}
