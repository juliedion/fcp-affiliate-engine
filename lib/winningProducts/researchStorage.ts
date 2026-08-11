import {
  CompetitorRecord, DEFAULT_PROFITABILITY_INPUTS, ProfitabilityInputs,
  ScoreFactorKey, ScoreFactorOverride, SupplierOption, TrendMetricRecord
} from "./types";

const KEYS = {
  competitors: "fort-wpf-competitors", // { [productId]: CompetitorRecord[] }
  suppliers: "fort-wpf-suppliers", // { [productId]: SupplierOption[] }
  trendMetrics: "fort-wpf-trend-metrics", // { [productId]: TrendMetricRecord[] }
  scoreOverrides: "fort-wpf-score-overrides", // { [productId]: ScoreFactorOverride[] }
  profitability: "fort-wpf-profitability" // { [productId]: ProfitabilityInputs }
};

const read = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => { if (typeof window !== "undefined") localStorage.setItem(key, JSON.stringify(value)); };

function makeBucketStore<T>(key: string) {
  return {
    getAll(): Record<string, T[]> { return read<Record<string, T[]>>(key, {}); },
    getFor(productId: string): T[] { return this.getAll()[productId] ?? []; },
    saveFor(productId: string, items: T[]) { const all = this.getAll(); all[productId] = items; write(key, all); }
  };
}

export const competitorStore = makeBucketStore<CompetitorRecord>(KEYS.competitors);
export const supplierStore = makeBucketStore<SupplierOption>(KEYS.suppliers);
export const trendMetricStore = makeBucketStore<TrendMetricRecord>(KEYS.trendMetrics);
export const scoreOverrideStore = makeBucketStore<ScoreFactorOverride>(KEYS.scoreOverrides);

export function getProfitabilityInputs(productId: string, seed?: Partial<ProfitabilityInputs>): ProfitabilityInputs {
  const all = read<Record<string, ProfitabilityInputs>>(KEYS.profitability, {});
  return all[productId] ?? { ...DEFAULT_PROFITABILITY_INPUTS, ...seed };
}
export function saveProfitabilityInputs(productId: string, inputs: ProfitabilityInputs) {
  const all = read<Record<string, ProfitabilityInputs>>(KEYS.profitability, {});
  all[productId] = inputs;
  write(KEYS.profitability, all);
}

export function setScoreOverride(productId: string, factor: ScoreFactorKey, override: Omit<ScoreFactorOverride, "factor">) {
  const existing = scoreOverrideStore.getFor(productId).filter(o => o.factor !== factor);
  scoreOverrideStore.saveFor(productId, [...existing, { factor, ...override }]);
}
export function clearScoreOverride(productId: string, factor: ScoreFactorKey) {
  scoreOverrideStore.saveFor(productId, scoreOverrideStore.getFor(productId).filter(o => o.factor !== factor));
}
