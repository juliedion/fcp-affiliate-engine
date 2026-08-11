import { ProfitabilityInputs, ProfitabilityOutputs } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Pure function — no I/O, safe to unit test directly.
export function calculateProfitability(inputs: ProfitabilityInputs): ProfitabilityOutputs {
  const price = Math.max(0, inputs.sellingPrice);
  const discounted = price * (1 - Math.max(0, inputs.discountPercent) / 100) * (1 - Math.max(0, inputs.bundleDiscountPercent) / 100);

  const landedCost = round2(Math.max(0, inputs.productCost) + Math.max(0, inputs.shipping) + Math.max(0, inputs.packaging));

  const shopifyFee = discounted * (Math.max(0, inputs.shopifyFeePercent) / 100);
  const processingFee = discounted * (Math.max(0, inputs.paymentProcessingPercent) / 100);
  const tax = discounted * (Math.max(0, inputs.taxPercent) / 100);
  const refundLoss = discounted * (Math.max(0, inputs.refundRatePercent) / 100);
  const returnLoss = landedCost * (Math.max(0, inputs.returnRatePercent) / 100);

  const grossProfit = round2(discounted - landedCost);
  const grossMarginPercent = discounted > 0 ? round2((grossProfit / discounted) * 100) : 0;

  const contributionMargin = round2(discounted - landedCost - shopifyFee - processingFee - tax - refundLoss - returnLoss);
  const profitPerOrder = round2(contributionMargin - Math.max(0, inputs.advertisingCostPerOrder));

  // Break-even CPA: the max you could spend on ads for this order and still break even.
  const breakEvenCpa = round2(Math.max(0, contributionMargin));
  // A conservative, achievable ad-spend target — 60% of break-even, leaving real profit margin.
  const targetCpa = round2(breakEvenCpa * 0.6);
  const breakEvenRoas = inputs.advertisingCostPerOrder > 0 ? round2(discounted / Math.max(0.01, breakEvenCpa)) : 0;

  const bestCase = round2(profitPerOrder * 1.25);
  const expectedCase = round2(profitPerOrder);
  const worstCase = round2(profitPerOrder * 0.6);

  return {
    landedCost, grossProfit, grossMarginPercent, contributionMargin,
    breakEvenCpa, targetCpa, breakEvenRoas, profitPerOrder,
    profitAt10: round2(profitPerOrder * 10),
    profitAt50: round2(profitPerOrder * 50),
    profitAt100: round2(profitPerOrder * 100),
    profitAt500: round2(profitPerOrder * 500),
    bestCase, expectedCase, worstCase
  };
}
