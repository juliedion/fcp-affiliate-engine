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

function benefitFromFeature(feature: string): string {
  const f = cleanFact(feature);
  const low = f.toLowerCase();
  if (/50\+.*surfaces/.test(low)) return "Use it on 50+ listed surfaces, so one tool can handle a wide range of craft and personalization projects.";
  if (/30.*bits/.test(low)) return "Thirty included engraving bits give you more options for detail work, lettering, textures, and different materials.";
  if (/rechargeable.*cordless|cordless.*rechargeable/.test(low)) return "The rechargeable cordless design lets you work without being tethered to an outlet.";
  if (/beginner/.test(low)) return "Beginner-friendly controls make it easier to start creating without a steep learning curve.";
  if (/mastery guide|guide included/.test(low)) return "An included guide helps you get comfortable with the tool and try more techniques.";
  if (/airtight/.test(low)) return "Airtight lids help keep ingredients covered and make leftovers easier to store.";
  if (/pull.?out|slide.?out/.test(low)) return "The pull-out design brings hard-to-reach items forward instead of making you dig through the cabinet.";
  if (/collaps|fold/.test(low)) return "It folds down when you are done, making storage and transport much easier.";
  if (/absorb/.test(low)) return "The absorbent surface helps contain drips and keeps the surrounding counter drier.";
  if (/smart|app|remind/.test(low)) return "Smart reminders make it easier to stay on top of the routine without constantly thinking about it.";
  if (/large|350l|capacity/.test(low)) return `${f.charAt(0).toUpperCase() + f.slice(1)} gives you useful extra room when you need to haul more at once.`;
  return `${f.charAt(0).toUpperCase() + f.slice(1)}.`;
}

function buildSpecificDescriptionHtml(input: {
  name: string; problem: string; features: string; audience: string; category: string; sourceDescription: string; fcpVerdict?: string;
}): string {
  const title = input.name.trim();
  const combined = `${title} ${input.category} ${input.features} ${input.sourceDescription}`.toLowerCase();
  const features = input.features.split(/[,\n•|]+/).map(cleanFact).filter(Boolean).filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).slice(0, 5);
  const bullets = features.map(f => `<li>${escapeHtml(benefitFromFeature(f))}</li>`).join("");

  let intro: string;
  let closer: string;
  if (/engrav|etch|customiz|personaliz/.test(combined)) {
    intro = `${title} is a compact cordless engraving tool made for turning everyday objects into personalized projects. Use it for names, designs, lettering, details, and decorative touches without setting up a full-size rotary station.`;
    closer = "A strong fit for crafters, DIYers, gift makers, and anyone who likes putting a custom touch on things they already own.";
  } else if (/organiz|spice rack|storage|pull.?out|pantry|cabinet/.test(combined)) {
    intro = `${title} is designed to make crowded cabinets and storage spaces easier to use. It brings items into view, cuts down on digging and stacking, and helps turn wasted space into storage that actually works.`;
    closer = "A practical upgrade for anyone who wants a more organized space without a full cabinet makeover.";
  } else if (/mixing bowl|kitchen|cook|bowl/.test(combined)) {
    intro = `${title} gives you a more organized way to prep, mix, store, and serve without reaching for a different container every time. It is the kind of kitchen set that earns its cabinet space because the pieces work together.`;
    closer = "Useful for everyday cooking, baking, meal prep, leftovers, and anyone trying to keep kitchen tools from taking over the cabinets.";
  } else if (/wagon|cart|haul|350l/.test(combined)) {
    intro = `${title} is built for the jobs that are annoying to make three trips for. Load it up for games, beach days, camping, yard work, events, or family outings, then fold it down when the hauling is done.`;
    closer = "A useful pick when you regularly move bulky gear but do not want a permanent cart taking up storage space.";
  } else if (/water bottle|hydration|drink/.test(combined)) {
    intro = `${title} adds a little accountability to something most of us forget to do: drink enough water. Its smart features help make hydration easier to track throughout the day without turning it into another chore.`;
    closer = "Especially handy for workdays, workouts, travel, or anyone who realizes at 4 p.m. they barely touched their water bottle.";
  } else if (/drying mat|absorbent|dish mat/.test(combined)) {
    intro = `${title} gives wet dishes, glasses, and cookware a dedicated place to drain without leaving a puddle across the counter. It is a simple kitchen upgrade, but one that can make cleanup feel noticeably less messy.`;
    closer = "A good fit for busy kitchens, small counters, and anyone who is tired of wiping up the same drips after every round of dishes.";
  } else if (/grill|outdoor kitchen/.test(combined)) {
    intro = `${title} is made for people who want more than a basic backyard grill. It creates a dedicated outdoor cooking setup with room to prep, cook, organize, and keep everything together in one station.`;
    closer = "A substantial backyard upgrade for frequent grillers and entertainers who want a more complete outdoor cooking setup.";
  } else if (/garden bed|planter|garden/.test(combined)) {
    intro = `${title} creates a contained growing space that is easier to manage than planting directly into the yard. It gives herbs, vegetables, and flowers a defined home while keeping the garden looking intentional.`;
    closer = "A good choice for gardeners who want a cleaner setup, easier access, and a more finished look in the yard or patio area.";
  } else {
    const problem = cleanFact(input.problem || "");
    intro = problem
      ? `${title} is designed to solve a very specific annoyance: ${problem.charAt(0).toLowerCase() + problem.slice(1)}. The appeal is simple — it gives you a more practical way to get the job done without adding extra steps.`
      : `${title} is a practical find built around useful features rather than gimmicks. It is designed to make the task easier, more organized, or more convenient in day-to-day use.`;
    closer = `Best suited for ${input.audience && !/busy families|busy households/i.test(input.audience) ? input.audience : "anyone who would actually use these features regularly"}.`;
  }

  const verdict = input.fcpVerdict?.trim() || closer;
  return `<p>${escapeHtml(intro)}</p>${bullets ? `<h3>Why we like it</h3><ul>${bullets}</ul>` : ""}<p>${escapeHtml(closer)}</p><p><strong>Fort Crazypants take:</strong> ${escapeHtml(verdict)}</p>`;
}

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const baseInput = polishWithoutAi(input);
    const deterministicBase = generateProduct(baseInput);
    const deterministic = { ...deterministicBase, descriptionHtml: buildSpecificDescriptionHtml(baseInput) };

    if (!isAiCopyEnabled()) {
      return NextResponse.json({ ...deterministic, aiCopyUsed: false, descriptionRewriteUsed: true });
    }

    const facts = await generateAIProductFacts(baseInput);
    const workingInput = facts ? { ...baseInput, ...facts } : baseInput;
    const regeneratedBase = generateProduct(workingInput);
    const regenerated = { ...regeneratedBase, descriptionHtml: buildSpecificDescriptionHtml(workingInput) };
    const overrides = await generateAICopy(workingInput, regenerated);
    return NextResponse.json({ ...applyAiCopy(regenerated, overrides), aiCopyUsed: Boolean(facts || overrides), descriptionRewriteUsed: true });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Invalid product data") }, { status: 400 });
  }
}
