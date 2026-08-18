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
  for (const sep of [",", " - ", " – ", " — ", " | "]) {
    const i = title.indexOf(sep);
    if (i >= 24 && i <= 85) { title = title.slice(0, i).trim(); break; }
  }
  title = title.replace(/\s+ultimate\s+cordless\s+portable\s+tool$/i, "").replace(/\s+cordless\s+portable\s+tool$/i, "").trim();
  if (title.length > 64) {
    const cut = title.slice(0, 64);
    const space = cut.lastIndexOf(" ");
    title = (space > 30 ? cut.slice(0, space) : cut).trim();
  }
  return title || name.trim();
}

function sentenceChunks(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\s*[•|]\s*/).map(s => s.trim()).filter(s => s.length >= 18);
}

function polishWithoutAi<T extends { name: string; problem: string; features: string; audience: string; category: string; sourceDescription: string; }>(input: T): T {
  const source = input.sourceDescription.trim();
  const combined = `${input.name} ${source} ${input.features}`.toLowerCase();
  const name = cleanMarketplaceTitle(input.name);
  const isEngraving = /engrav|engraver|engraving pen|rotary tool|etch|customiz|personaliz/.test(combined);

  let audience = input.audience;
  if (isEngraving) audience = "artists, DIYers, crafters, and makers";

  let problem = input.problem;
  if (isEngraving) problem = "personalizing crafts and DIY projects without needing a bulky full-size engraving setup";
  else if (!problem || /everyday inconvenience|everyday frustration|daily routine/i.test(problem)) {
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
    const chunks = sentenceChunks(source).map(s => s.replace(/^buy\s+/i, "").replace(/[.!?]+$/, "")).filter(s => !/^amazon/i.test(s)).slice(0, 5);
    if (chunks.length) features = chunks.join(", ");
  }

  let category = input.category;
  if (isEngraving) category = "Craft Tools & Engraving";
  return { ...input, name, problem, features, audience, category };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cleanFact(value: string): string {
  return value.trim().replace(/^[-•]+\s*/, "").replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

function splitFacts(features: string): string[] {
  return features.split(/[,\n•|]+/).map(cleanFact).filter(x => x.length > 2)
    .filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).slice(0, 6);
}

function benefitFromFeature(feature: string): string {
  const f = cleanFact(feature);
  const low = f.toLowerCase();
  if (/50\+.*surfaces/.test(low)) return "One tool can handle a wide range of personalization projects instead of needing a different setup for each material.";
  if (/30.*bits/.test(low)) return "You have more options for lettering, detail work, texture, and finishing without buying a separate bit set right away.";
  if (/rechargeable.*cordless|cordless.*rechargeable/.test(low)) return "You can work where the project is instead of arranging everything around the nearest outlet.";
  if (/beginner/.test(low)) return "It is easier to get started without feeling like you need advanced tool experience first.";
  if (/mastery guide|guide included/.test(low)) return "The included guidance helps shorten the learning curve and gives you a clearer starting point.";
  if (/airtight/.test(low)) return "Ingredients and leftovers can stay covered in the same bowls, cutting down on extra containers and cleanup.";
  if (/pull.?out|slide.?out/.test(low)) return "Items at the back come to you, so you spend less time unloading the cabinet just to reach one thing.";
  if (/collaps|fold/.test(low)) return "You get the carrying capacity when you need it without giving up permanent storage space when you do not.";
  if (/absorb/.test(low)) return "Drips stay contained in one place, which means less water spreading across the counter after dishes.";
  if (/smart|app|remind/.test(low)) return "The reminder system takes some of the mental load out of remembering the routine yourself.";
  if (/large|350l|capacity/.test(low)) return "You can move more in a single trip, which is especially useful for bulky family gear and outdoor outings.";
  return "It adds useful functionality without requiring extra steps or a complicated setup.";
}

function realSpecification(feature: string): boolean {
  const f = feature.toLowerCase();
  return /\d|inch|inches|\bl\b|liter|litre|oz|ounce|lb|pound|watt|volt|mah|usb|battery|rechargeable|cordless|stainless|steel|aluminum|aluminium|silicone|microfiber|wood|plastic|material|compatible|includes?|pieces?|pack|capacity|dimension|size|surface/.test(f);
}

function proseDescription(input: { name: string; problem: string; features: string; audience: string; category: string; sourceDescription: string; fcpVerdict?: string; }): string {
  const title = input.name.trim();
  const combined = `${title} ${input.category} ${input.features} ${input.sourceDescription}`.toLowerCase();
  let intro: string;
  let useCase: string;

  if (/engrav|etch|customiz|personaliz/.test(combined)) {
    intro = `${title} gives you a compact way to personalize everyday objects without setting up a full-size rotary station. It is made for the kind of projects where you want to add names, lettering, decorative details, or a custom finish and then put the tool away when you are done.`;
    useCase = "That makes it especially appealing for crafters, DIYers, gift makers, and anyone who likes turning ordinary pieces into something personal.";
  } else if (/organiz|spice rack|storage|pull.?out|pantry|cabinet/.test(combined)) {
    intro = `${title} tackles one of the most annoying storage problems: having plenty of cabinet space but not being able to reach what is in it. Instead of stacking, digging, and unloading half the shelf, it is designed to make the contents easier to see and grab.`;
    useCase = "It is the kind of upgrade that makes the space you already have work better without requiring a cabinet remodel.";
  } else if (/mixing bowl|kitchen|cook|bowl/.test(combined)) {
    intro = `${title} is built around a simple kitchen win: fewer separate containers for prep, mixing, serving, and storage. A coordinated set keeps the workflow together and can cut down on the pile of mismatched bowls and lids taking over the cabinet.`;
    useCase = "It makes the most sense for everyday cooking, baking, meal prep, and leftovers—jobs where the same pieces get reached for again and again.";
  } else if (/wagon|cart|haul|350l/.test(combined)) {
    intro = `${title} is for the moments when carrying everything by hand turns into three unnecessary trips. It gives bulky gear one place to go for games, beach days, camping, yard work, events, and family outings.`;
    useCase = "The real advantage is having serious hauling help when you need it without dedicating permanent garage space to a rigid cart.";
  } else if (/water bottle|hydration|drink/.test(combined)) {
    intro = `${title} is aimed at the part of hydration that is surprisingly hard: remembering to keep drinking throughout the day. Instead of relying on good intentions, it adds a little structure and feedback to a habit that is easy to forget.`;
    useCase = "It is particularly useful during workdays, workouts, travel, or any routine where your water bottle tends to sit untouched for hours.";
  } else if (/drying mat|absorbent|dish mat/.test(combined)) {
    intro = `${title} gives wet dishes and cookware a dedicated landing spot instead of letting drips spread across the counter. It is a small change, but it addresses the part of doing dishes that somehow creates another cleanup job afterward.`;
    useCase = "It is a practical fit for busy kitchens, limited counter space, and anyone tired of wiping up the same puddles every day.";
  } else if (/grill|outdoor kitchen/.test(combined)) {
    intro = `${title} is designed for people who want their backyard cooking area to function more like a real kitchen than a standalone grill. The value is having prep, cooking, organization, and serving space work together instead of being scattered across the patio.`;
    useCase = "It is best suited to frequent grillers and entertainers who will actually use the extra workspace and built-in organization.";
  } else if (/garden bed|planter|garden/.test(combined)) {
    intro = `${title} creates a defined place to grow herbs, vegetables, or flowers without turning a section of the yard into a full garden project. It keeps the growing area contained and gives the space a more intentional, finished look.`;
    useCase = "It is a good option when you want easier access and a cleaner setup on a patio, deck, or in the yard.";
  } else {
    const problem = cleanFact(input.problem || "");
    intro = problem
      ? `${title} is built to address a specific frustration: ${problem.charAt(0).toLowerCase() + problem.slice(1)}. The appeal is that it offers a more straightforward way to handle that job without adding unnecessary complexity.`
      : `${title} is a practical find centered on making a common task easier to manage.`;
    useCase = `It is best for ${input.audience && !/busy families|busy households/i.test(input.audience) ? input.audience : "people who would use its core features regularly"}.`;
  }

  return `<h2>Why You'll Love It</h2><p>${escapeHtml(intro)}</p><p>${escapeHtml(useCase)}</p>`;
}

function stripListsFromDescription(html: string, fallback: string): string {
  if (!html || typeof html !== "string") return fallback;
  let clean = html
    .replace(/<ul[\s\S]*?<\/ul>/gi, "")
    .replace(/<ol[\s\S]*?<\/ol>/gi, "")
    .replace(/<h3[\s\S]*?<\/h3>/gi, "")
    .replace(/^\s*<h2>.*?<\/h2>/i, "<h2>Why You'll Love It</h2>")
    .replace(/\s{2,}/g, " ")
    .trim();
  const paragraphs = clean.match(/<p[\s\S]*?<\/p>/gi) || [];
  if (paragraphs.length < 2) return fallback;
  return `<h2>Why You'll Love It</h2>${paragraphs.slice(0, 3).join("")}`;
}

function enforceDistinctSections<T extends { descriptionHtml: string; bullets: string[]; benefits: string[]; specifications: string[]; }>(product: T, input: { name: string; problem: string; features: string; audience: string; category: string; sourceDescription: string; fcpVerdict?: string; }): T {
  const facts = splitFacts(input.features);
  const bullets = facts.map(f => f.charAt(0).toUpperCase() + f.slice(1));
  const benefits = facts.slice(0, 4).map(benefitFromFeature)
    .filter((x, i, a) => a.indexOf(x) === i && !bullets.some(b => b.toLowerCase() === x.toLowerCase()));
  const specifications = facts.filter(realSpecification).map(f => f.charAt(0).toUpperCase() + f.slice(1));
  const fallbackDescription = proseDescription(input);
  return {
    ...product,
    descriptionHtml: stripListsFromDescription(product.descriptionHtml, fallbackDescription),
    bullets,
    benefits,
    specifications
  };
}

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const baseInput = polishWithoutAi(input);
    const deterministicBase = generateProduct(baseInput);
    const deterministic = enforceDistinctSections({ ...deterministicBase, descriptionHtml: proseDescription(baseInput) }, baseInput);

    if (!isAiCopyEnabled()) {
      return NextResponse.json({ ...deterministic, aiCopyUsed: false, descriptionRewriteUsed: true, distinctSectionsUsed: true });
    }

    const facts = await generateAIProductFacts(baseInput);
    const workingInput = facts ? { ...baseInput, ...facts } : baseInput;
    const regeneratedBase = generateProduct(workingInput);
    const regenerated = enforceDistinctSections({ ...regeneratedBase, descriptionHtml: proseDescription(workingInput) }, workingInput);
    const overrides = await generateAICopy(workingInput, regenerated);
    const withAi = applyAiCopy(regenerated, overrides);
    const finalProduct = enforceDistinctSections(withAi, workingInput);

    return NextResponse.json({ ...finalProduct, aiCopyUsed: Boolean(facts || overrides), descriptionRewriteUsed: true, distinctSectionsUsed: true });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Invalid product data") }, { status: 400 });
  }
}
