import { Badge, DEFAULT_WEIGHTS, FortFitBreakdown, ProductOpportunity, RawProductOpportunity, ScoreBreakdown, ScoreWeights, SupportingEvidence, TrendStage } from "./types";

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

function competitionScore(level: "low" | "medium" | "high"): number {
  return level === "low" ? 95 : level === "medium" ? 60 : 25;
}

function shippingScore(days: number | null): number {
  if (days === null) return 50;
  if (days <= 7) return 100;
  if (days <= 12) return 75;
  if (days <= 20) return 45;
  return 15;
}

function marginScore(margin: number | null): number {
  if (margin === null) return 40;
  if (margin >= 60) return 100;
  if (margin >= 45) return 80;
  if (margin >= 30) return 55;
  return 25;
}

function demoScore(demoPotential: "low" | "medium" | "high"): number {
  return demoPotential === "high" ? 100 : demoPotential === "medium" ? 60 : 25;
}

function problemScore(problemSolving: boolean): number {
  return problemSolving ? 90 : 45;
}

function fortFitScore(raw: RawProductOpportunity): FortFitBreakdown {
  const familyFriendly = raw.familyFriendly ? 10 : 4;
  const useful = raw.problemSolving ? 10 : 6;
  const fun = raw.demoPotential === "high" ? 10 : raw.demoPotential === "medium" ? 6 : 3;
  const problemSolvingPts = raw.problemSolving ? 10 : 3;
  const price = raw.estimatedSellingPrice ?? raw.retailPrice.value ?? 0;
  const affordable = price > 0 && price <= 60 ? 10 : price <= 120 ? 6 : 3;
  const easyToDemonstrate = raw.demonstrable ? 10 : 4;
  const socialMediaFriendly = raw.scoringInputs.socialMomentumScore >= 60 ? 10 : raw.scoringInputs.socialMomentumScore >= 35 ? 6 : 3;
  const giftable = raw.giftable ? 10 : 4;
  const impulseFriendly = raw.impulseFriendly ? 10 : 5;
  const categoryFit = raw.category !== "Uncategorized" ? 10 : 4;

  const total = Math.round(familyFriendly + useful + fun + problemSolvingPts + affordable + easyToDemonstrate + socialMediaFriendly + giftable + impulseFriendly + categoryFit);

  const strengths: string[] = [];
  if (raw.familyFriendly) strengths.push("family-friendly appeal");
  if (raw.problemSolving) strengths.push("clear problem-solving value");
  if (raw.demonstrable) strengths.push("strong demo potential");
  if (raw.giftable) strengths.push("giftability");
  if (affordable === 10) strengths.push(`an accessible $${price.toFixed(2)} price point`);
  const weaknesses: string[] = [];
  if (!raw.familyFriendly) weaknesses.push("limited family appeal");
  if (!raw.demonstrable) weaknesses.push("harder to demonstrate on video");
  if (affordable <= 6) weaknesses.push("a price point above typical impulse range");

  const explanation = `${raw.title} scores ${total}/100 on Fort Fit${strengths.length ? `, driven by ${strengths.join(", ")}` : ""}${weaknesses.length ? `. Watch for ${weaknesses.join(" and ")}` : ""}. ${raw.category !== "Uncategorized" ? `It maps cleanly to the "${raw.category}" collection.` : "It doesn't map cleanly to an existing Fort Crazypants collection."}`;

  return { total: clamp(total, 0, 100), familyFriendly, useful, fun, problemSolving: problemSolvingPts, affordable, easyToDemonstrate, socialMediaFriendly, giftable, impulseFriendly, categoryFit, explanation };
}

function deriveTrendStage(raw: RawProductOpportunity, demandScore: number, competition: "low" | "medium" | "high"): TrendStage {
  if (raw.seasonalRelevance === "seasonal") return "Seasonal Opportunity";
  // Only bail to "Needs More Data" when there's genuinely no demand signal to work
  // with (e.g. a CSV row with no trend data) — not just because the source is mock/dev data.
  if (raw.searchTrend.quality === "unavailable") return "Needs More Data";
  if (demandScore >= 75 && competition !== "high") return "Strong Candidate";
  if (demandScore >= 55) return "Gaining Momentum";
  if (demandScore >= 35) return "Emerging";
  if (competition === "high" && demandScore < 40) return "Saturated";
  return "Declining";
}

function deriveBadges(raw: RawProductOpportunity, score: ScoreBreakdown, fortFit: FortFitBreakdown): Badge[] {
  const badges: Badge[] = [];
  if (raw.scoringInputs.demandTrendScore >= 75) badges.push("rising_fast");
  if ((raw.estimatedMargin ?? 0) >= 55) badges.push("high_margin");
  if (raw.demonstrable) badges.push("easy_to_demo");
  if (fortFit.total >= 80) badges.push("strong_fort_fit");
  if (raw.giftable) badges.push("giftable");
  if (raw.competitionLevel === "high") badges.push("high_competition");
  if ((raw.shippingDays.value ?? 0) > 15) badges.push("slow_shipping");
  if (raw.seasonalRelevance === "seasonal") badges.push("seasonal");
  return badges;
}

export function scoreOpportunity(raw: RawProductOpportunity, weights: ScoreWeights = DEFAULT_WEIGHTS): ProductOpportunity {
  const demand = clamp(raw.scoringInputs.demandTrendScore);
  const social = clamp(raw.scoringInputs.socialMomentumScore);
  const profit = marginScore(raw.estimatedMargin);
  const competition = competitionScore(raw.competitionLevel);
  const demo = demoScore(raw.demoPotential);
  const problem = problemScore(raw.problemSolving);
  const fortFit = fortFitScore(raw);
  const shipping = shippingScore(raw.shippingDays.value);
  const sentiment = raw.scoringInputs.ratingScore;

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0) || 100;
  const norm = (n: number) => n / (weightSum / 100);

  const breakdown: ScoreBreakdown = {
    demandTrend: round1((demand / 100) * norm(weights.demandTrend)),
    socialMomentum: round1((social / 100) * norm(weights.socialMomentum)),
    profitPotential: round1((profit / 100) * norm(weights.profitPotential)),
    competition: round1((competition / 100) * norm(weights.competition)),
    demoPotential: round1((demo / 100) * norm(weights.demoPotential)),
    problemSolving: round1((problem / 100) * norm(weights.problemSolving)),
    fortFit: round1((fortFit.total / 100) * norm(weights.fortFit)),
    shippingSupplier: round1((shipping / 100) * norm(weights.shippingSupplier)),
    customerSentiment: round1((sentiment / 100) * norm(weights.customerSentiment)),
    total: 0
  };
  breakdown.total = Math.round(breakdown.demandTrend + breakdown.socialMomentum + breakdown.profitPotential + breakdown.competition + breakdown.demoPotential + breakdown.problemSolving + breakdown.fortFit + breakdown.shippingSupplier + breakdown.customerSentiment);

  const confidenceHint = raw.confidenceHint ?? (raw.isMock ? "low" : "medium");
  const trendStage = deriveTrendStage(raw, demand, raw.competitionLevel);
  const badges = deriveBadges(raw, breakdown, fortFit);

  const evidence: SupportingEvidence[] = [...raw.evidenceSeed];

  return {
    ...raw,
    score: breakdown,
    fortFit,
    confidence: confidenceHint,
    badges,
    trendStage,
    evidence,
    aiSummary: buildAiSummary(raw, breakdown, fortFit, trendStage),
    status: "new"
  };
}

function buildAiSummary(raw: RawProductOpportunity, score: ScoreBreakdown, fortFit: FortFitBreakdown, trendStage: TrendStage) {
  const price = raw.estimatedSellingPrice ?? raw.retailPrice.value ?? 0;
  const recommendation =
    trendStage === "Saturated" ? "Saturated" :
    trendStage === "Seasonal Opportunity" ? "Seasonal — Revisit Later" :
    trendStage === "Needs More Data" ? "Research Further" :
    score.total >= 78 ? "Test Now" :
    score.total >= 60 ? "Add to Watchlist" :
    score.total >= 45 ? "Research Further" : "Skip";

  return {
    momentumReason: `${raw.title} shows a ${raw.scoringInputs.demandTrendScore >= 60 ? "rising" : raw.scoringInputs.demandTrendScore >= 35 ? "steady" : "soft"} demand signal from ${raw.source.replace(/_/g, " ")}, currently trending as "${trendStage}."`,
    whoWouldBuy: raw.targetAudience || "Not enough verified data.",
    problemSolved: raw.problemSolved || "Not enough verified data.",
    fortFitReason: fortFit.explanation,
    bestSeason: raw.seasonalRelevance === "seasonal" ? "Seasonal — time promotion around its peak window." : "Evergreen — can be tested and promoted year-round.",
    bestPlatform: raw.scoringInputs.socialMomentumScore >= 60 ? "TikTok / Instagram Reels" : raw.demonstrable ? "Instagram / Pinterest" : "Email / Google Shopping",
    contentAngle: raw.problemSolving ? `Lead with the "before/after" problem-solution angle around ${raw.problemSolved || "the core pain point"}.` : "Lead with a lifestyle or aesthetic angle rather than a problem-solution hook.",
    suggestedRetailPrice: Math.round(price * 100) / 100,
    risks: raw.competitionLevel === "high" ? "High competition — differentiate on branding, bundling, or price." : (raw.shippingDays.value ?? 0) > 15 ? "Shipping time is long enough to hurt conversion; consider domestic stock." : "No major risks flagged by current signals.",
    recommendation: recommendation as ProductOpportunity["aiSummary"]["recommendation"]
  };
}
