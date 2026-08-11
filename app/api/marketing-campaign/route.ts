import { NextResponse } from "next/server";
import { z } from "zod";
import { formatApiError } from "@/lib/apiError";

// Real LLM-generated marketing campaign (OpenAI), distinct from the deterministic
// lib/generator.ts templates. Scoped to the highest-value asset types first — full
// personas/angles/headlines/hooks/CTAs/ad copy for 3 platforms — rather than the full
// ~40-category wishlist, to keep per-product cost, latency, and output quality reasonable.
const schema = z.object({
  title: z.string().min(2),
  description: z.string().default(""),
  category: z.string().default(""),
  audience: z.string().default(""),
  problem: z.string().default(""),
  features: z.string().default(""),
  price: z.coerce.number().default(0),
  brandVoice: z.string().default(""),
  adIdeas: z.string().default(""),
  fullPackage: z.boolean().default(false)
});

const SCHEMA_INSTRUCTIONS = `Return ONLY valid JSON matching exactly this shape (no markdown fences, no commentary):
{
  "analysis": {
    "oneSentenceSummary": string,
    "uniqueSellingProposition": string,
    "idealCustomer": string,
    "topBenefits": string[] (5 items),
    "topPainPoints": string[] (5 items),
    "emotionalDrivers": string[] (5 items),
    "buyingTriggers": string[] (5 items),
    "objections": string[] (4 items),
    "competitiveAdvantages": string[] (4 items),
    "urgencyFactors": string[] (3 items),
    "overallScore": number (0-100, realistic assessment of marketing potential),
    "recommendedPlatform": string (which single platform to prioritize and why, one sentence),
    "recommendedTone": string (one sentence)
  },
  "personas": [ { "name": string, "ageRange": string, "incomeRange": string, "lifestyle": string, "painPoints": string[] (3 items), "buyingMotivation": string, "messagingAngle": string } ] (exactly 3 distinct personas),
  "marketingAngles": [ { "angle": string (short label like "Problem Solver" or "Gift-Giving"), "pitch": string (1-2 sentences using this angle) } ] (exactly 10 items, all distinct),
  "headlines": string[] (exactly 10, high-CTR style, varied),
  "hooks": string[] (exactly 10, scroll-stopping opening lines for video/social),
  "ctas": string[] (exactly 10, varied calls-to-action),
  "adCopy": {
    "facebook": { "short": string, "medium": string, "long": string },
    "instagram": { "short": string, "medium": string, "long": string },
    "googleSearch": { "short": string (<=30 chars headline style), "medium": string (<=90 chars), "long": string (full description ~180 chars) }
  }
}`;

const FULL_PACKAGE_ADDITION = `
Also include these two top-level keys in the same JSON object:
"socialPosts": {
  "instagram": string[] (4 distinct post captions),
  "facebook": string[] (4 distinct posts),
  "pinterest": string[] (4 distinct pin descriptions),
  "tiktok": string[] (4 distinct short video captions/hooks),
  "x": string[] (4 distinct posts, <=280 chars each)
},
"emails": [ { "type": string (e.g. "Product Launch", "Abandoned Cart", "Flash Sale"), "subject": string, "body": string } ] (exactly 3 emails, different types),
"landingPage": {
  "heroHeadline": string,
  "heroSubheadline": string,
  "heroCta": string,
  "features": string[] (5 items),
  "benefits": string[] (5 items),
  "faq": [ { "question": string, "answer": string } ] (5 items),
  "finalCta": string,
  "testimonialPlaceholderNote": "Add 2-3 real customer testimonials here before publishing — never fabricate customer quotes."
}`;

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 400 });

    const productBrief = [
      `Product: ${input.title}`,
      input.category && `Category: ${input.category}`,
      input.price > 0 && `Price: $${input.price}`,
      input.audience && `Target audience: ${input.audience}`,
      input.problem && `Problem it solves: ${input.problem}`,
      input.features && `Features: ${input.features}`,
      input.description && `Description: ${input.description}`,
      input.adIdeas && `The merchant specifically wants these ideas/angles/tone incorporated: ${input.adIdeas}`
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are a senior ecommerce marketing strategist writing a real campaign for a specific product. Be concrete and specific to THIS product — never generic filler that could apply to any product. Do not invent specific statistics, review counts, or claims that would be false advertising. ${input.brandVoice ? `Brand voice: ${input.brandVoice}` : ""}${input.adIdeas ? " The merchant has provided specific ideas below — weave them into the relevant sections (angles, headlines, hooks, ad copy) rather than ignoring them." : ""}`;
    const userPrompt = `${productBrief}\n\n${SCHEMA_INSTRUCTIONS}${input.fullPackage ? FULL_PACKAGE_ADDITION : ""}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.8
      })
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: data?.error?.message || "Campaign generation failed." }, { status: r.status });

    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return NextResponse.json({ error: "OpenAI returned no content." }, { status: 502 });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "OpenAI returned invalid JSON — try generating again." }, { status: 502 });
    }

    return NextResponse.json({ generatedAt: new Date().toISOString(), ...(parsed as object) });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Campaign generation failed.") }, { status: 400 });
  }
}
