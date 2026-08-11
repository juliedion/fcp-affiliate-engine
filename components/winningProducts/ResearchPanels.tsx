"use client";
import { useEffect, useState } from "react";
import {
  CompetitorPlatform, CompetitorRecord, DEFAULT_PROFITABILITY_INPUTS, ProductOpportunity,
  ProfitabilityInputs, ScoreFactorKey, SupplierOption, SupplierType, TrendMetricCategory, TrendMetricRecord
} from "@/lib/winningProducts/types";
import { calculateProfitability } from "@/lib/winningProducts/profitability";
import {
  competitorStore, getProfitabilityInputs, saveProfitabilityInputs, scoreOverrideStore,
  setScoreOverride, clearScoreOverride, supplierStore, trendMetricStore
} from "@/lib/winningProducts/researchStorage";
import { money, pct } from "@/lib/winningProducts/format";

const uid = () => `${Date.now()}-${Math.round(Math.random() * 100000)}`;

// --- Profitability Calculator ---
export function ProfitabilityPanel({ product }: { product: ProductOpportunity }) {
  const [inputs, setInputs] = useState<ProfitabilityInputs>(() => getProfitabilityInputs(product.id, {
    sellingPrice: product.aiSummary.suggestedRetailPrice || product.retailPrice.value || 0,
    productCost: product.supplierCost.value || 0
  }));
  useEffect(() => { saveProfitabilityInputs(product.id, inputs); }, [inputs, product.id]);
  const set = <K extends keyof ProfitabilityInputs>(key: K, value: number) => setInputs(i => ({ ...i, [key]: value }));
  const out = calculateProfitability(inputs);

  const fields: { key: keyof ProfitabilityInputs; label: string }[] = [
    { key: "sellingPrice", label: "Selling price" }, { key: "productCost", label: "Product cost" },
    { key: "shipping", label: "Shipping" }, { key: "packaging", label: "Packaging" },
    { key: "shopifyFeePercent", label: "Shopify fees %" }, { key: "paymentProcessingPercent", label: "Payment processing %" },
    { key: "advertisingCostPerOrder", label: "Advertising cost / order" }, { key: "refundRatePercent", label: "Refund rate %" },
    { key: "returnRatePercent", label: "Return rate %" }, { key: "discountPercent", label: "Discount %" },
    { key: "bundleDiscountPercent", label: "Bundle discount %" }, { key: "taxPercent", label: "Tax %" }
  ];

  return (
    <div>
      <div className="merchBlock"><h3>Profitability Calculator — Inputs</h3>
        <div className="fields">
          {fields.map(f => <div className="field" key={f.key}><label>{f.label}</label><input type="number" value={inputs[f.key]} onChange={e => set(f.key, +e.target.value)} /></div>)}
        </div>
      </div>
      <div className="merchGrid">
        <div className="merchBlock"><h3>Unit Economics</h3>
          <ul>
            <li>Landed cost: {money(out.landedCost)}</li>
            <li>Gross profit: {money(out.grossProfit)}</li>
            <li>Gross margin: {pct(out.grossMarginPercent)}</li>
            <li>Contribution margin: {money(out.contributionMargin)}</li>
            <li>Profit per order: {money(out.profitPerOrder)}</li>
          </ul>
        </div>
        <div className="merchBlock"><h3>Ad Spend Targets</h3>
          <ul>
            <li>Break-even CPA: {money(out.breakEvenCpa)}</li>
            <li>Target CPA (60% of break-even): {money(out.targetCpa)}</li>
            <li>Break-even ROAS: {out.breakEvenRoas.toFixed(2)}x</li>
          </ul>
        </div>
      </div>
      <div className="merchGrid">
        <div className="merchBlock"><h3>Profit at Volume</h3>
          <ul>
            <li>10 orders: {money(out.profitAt10)}</li>
            <li>50 orders: {money(out.profitAt50)}</li>
            <li>100 orders: {money(out.profitAt100)}</li>
            <li>500 orders: {money(out.profitAt500)}</li>
          </ul>
        </div>
        <div className="merchBlock"><h3>Scenarios (per order)</h3>
          <ul>
            <li>Best case: {money(out.bestCase)}</li>
            <li>Expected case: {money(out.expectedCase)}</li>
            <li>Worst case: {money(out.worstCase)}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// --- Trend Evidence ---
const TREND_CATEGORIES: TrendMetricCategory[] = ["Social engagement", "Ad longevity", "Review growth", "Search growth", "Sales-rank movement", "Competitor activity", "Customer comments", "Seasonal demand", "Creator coverage", "Cross-platform appearances"];

export function TrendEvidencePanel({ productId }: { productId: string }) {
  const [records, setRecords] = useState<TrendMetricRecord[]>(() => trendMetricStore.getFor(productId));
  const save = (next: TrendMetricRecord[]) => { setRecords(next); trendMetricStore.saveFor(productId, next); };
  const add = () => save([...records, { id: uid(), category: "Search growth", source: "", url: "", dateCaptured: new Date().toISOString().slice(0, 10), metric: "", currentValue: "", previousValue: "", growthPercent: null, notes: "", confidence: "medium" }]);
  const update = (id: string, patch: Partial<TrendMetricRecord>) => save(records.map(r => r.id === id ? { ...r, ...patch } : r));
  const remove = (id: string) => save(records.filter(r => r.id !== id));

  return (
    <div className="merchBlock"><h3>Trend Evidence</h3>
      {records.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No trend evidence recorded yet.</p>}
      {records.map(r => (
        <div key={r.id} className="wpfResearchRow">
          <div className="fields">
            <div className="field"><label>Category</label><select value={r.category} onChange={e => update(r.id, { category: e.target.value as TrendMetricCategory })}>{TREND_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div className="field"><label>Source</label><input value={r.source} onChange={e => update(r.id, { source: e.target.value })} placeholder="e.g. TikTok, Amazon" /></div>
            <div className="field full"><label>URL</label><input value={r.url} onChange={e => update(r.id, { url: e.target.value })} placeholder="https://..." /></div>
            <div className="field"><label>Date captured</label><input type="date" value={r.dateCaptured} onChange={e => update(r.id, { dateCaptured: e.target.value })} /></div>
            <div className="field"><label>Metric</label><input value={r.metric} onChange={e => update(r.id, { metric: e.target.value })} placeholder="e.g. weekly views" /></div>
            <div className="field"><label>Previous value</label><input value={r.previousValue} onChange={e => update(r.id, { previousValue: e.target.value })} /></div>
            <div className="field"><label>Current value</label><input value={r.currentValue} onChange={e => update(r.id, { currentValue: e.target.value })} /></div>
            <div className="field"><label>Growth %</label><input type="number" value={r.growthPercent ?? ""} onChange={e => update(r.id, { growthPercent: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Confidence</label><select value={r.confidence} onChange={e => update(r.id, { confidence: e.target.value as TrendMetricRecord["confidence"] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
            <div className="field full"><label>Notes</label><input value={r.notes} onChange={e => update(r.id, { notes: e.target.value })} /></div>
          </div>
          <button className="secondary" onClick={() => remove(r.id)}>Remove</button>
        </div>
      ))}
      <button className="secondary" onClick={add} style={{ marginTop: 8 }}>+ Add Trend Evidence</button>
    </div>
  );
}

// --- Competitor Research ---
const COMPETITOR_PLATFORMS: CompetitorPlatform[] = ["Shopify", "Amazon", "TikTok Shop", "Etsy", "Major Retailer"];

export function CompetitorPanel({ productId }: { productId: string }) {
  const [records, setRecords] = useState<CompetitorRecord[]>(() => competitorStore.getFor(productId));
  const save = (next: CompetitorRecord[]) => { setRecords(next); competitorStore.saveFor(productId, next); };
  const add = () => save([...records, { id: uid(), platform: "Shopify", url: "", storeName: "", productTitle: "", price: null, discount: "", bundle: "", shippingOffer: "", reviews: null, rating: null, positioning: "", marketingAngle: "", strengths: "", weaknesses: "", landingPageNotes: "", creativeExamples: "", dateReviewed: new Date().toISOString().slice(0, 10) }]);
  const update = (id: string, patch: Partial<CompetitorRecord>) => save(records.map(r => r.id === id ? { ...r, ...patch } : r));
  const remove = (id: string) => save(records.filter(r => r.id !== id));

  return (
    <div className="merchBlock"><h3>Competitor Research</h3>
      {records.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No competitors recorded yet.</p>}
      {records.length > 0 && <div style={{ overflowX: "auto" }}>
        <table className="wpfTable">
          <thead><tr><th>Platform</th><th>Store</th><th>Price</th><th>Reviews</th><th>Positioning</th><th></th></tr></thead>
          <tbody>{records.map(r => <tr key={r.id}><td>{r.platform}</td><td>{r.storeName || "—"}</td><td>{r.price !== null ? money(r.price) : "—"}</td><td>{r.reviews ?? "—"}</td><td>{r.positioning || "—"}</td><td><button className="secondary" onClick={() => remove(r.id)}>✕</button></td></tr>)}</tbody>
        </table>
      </div>}
      {records.map(r => (
        <div key={r.id} className="wpfResearchRow">
          <div className="fields">
            <div className="field"><label>Platform</label><select value={r.platform} onChange={e => update(r.id, { platform: e.target.value as CompetitorPlatform })}>{COMPETITOR_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
            <div className="field"><label>Store name</label><input value={r.storeName} onChange={e => update(r.id, { storeName: e.target.value })} /></div>
            <div className="field full"><label>URL</label><input value={r.url} onChange={e => update(r.id, { url: e.target.value })} /></div>
            <div className="field full"><label>Product title</label><input value={r.productTitle} onChange={e => update(r.id, { productTitle: e.target.value })} /></div>
            <div className="field"><label>Price</label><input type="number" value={r.price ?? ""} onChange={e => update(r.id, { price: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Discount</label><input value={r.discount} onChange={e => update(r.id, { discount: e.target.value })} /></div>
            <div className="field"><label>Bundle</label><input value={r.bundle} onChange={e => update(r.id, { bundle: e.target.value })} /></div>
            <div className="field"><label>Shipping offer</label><input value={r.shippingOffer} onChange={e => update(r.id, { shippingOffer: e.target.value })} /></div>
            <div className="field"><label>Reviews</label><input type="number" value={r.reviews ?? ""} onChange={e => update(r.id, { reviews: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Rating</label><input type="number" value={r.rating ?? ""} onChange={e => update(r.id, { rating: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field full"><label>Positioning</label><input value={r.positioning} onChange={e => update(r.id, { positioning: e.target.value })} /></div>
            <div className="field full"><label>Marketing angle</label><input value={r.marketingAngle} onChange={e => update(r.id, { marketingAngle: e.target.value })} /></div>
            <div className="field"><label>Strengths</label><input value={r.strengths} onChange={e => update(r.id, { strengths: e.target.value })} /></div>
            <div className="field"><label>Weaknesses</label><input value={r.weaknesses} onChange={e => update(r.id, { weaknesses: e.target.value })} /></div>
          </div>
          <button className="secondary" onClick={() => remove(r.id)}>Remove</button>
        </div>
      ))}
      <button className="secondary" onClick={add} style={{ marginTop: 8 }}>+ Add Competitor</button>
    </div>
  );
}

// --- Supplier Comparison ---
const SUPPLIER_TYPES: SupplierType[] = ["CJ Dropshipping", "Zendrop", "AutoDS", "Alibaba", "AliExpress", "Private supplier", "US wholesaler", "Manual supplier"];

export function SupplierPanel({ productId }: { productId: string }) {
  const [records, setRecords] = useState<SupplierOption[]>(() => supplierStore.getFor(productId));
  const save = (next: SupplierOption[]) => { setRecords(next); supplierStore.saveFor(productId, next); };
  const add = () => save([...records, { id: uid(), supplierType: "CJ Dropshipping", supplierName: "", productCost: null, shippingCost: null, deliveryDaysMin: null, deliveryDaysMax: null, processingDays: null, warehouse: "", moq: null, brandingOptions: false, packagingOptions: false, inventory: "", supplierRating: null, refundPolicy: "", sampleStatus: "Not requested", lastVerified: null, notes: "" }]);
  const update = (id: string, patch: Partial<SupplierOption>) => save(records.map(r => r.id === id ? { ...r, ...patch } : r));
  const remove = (id: string) => save(records.filter(r => r.id !== id));

  return (
    <div className="merchBlock"><h3>Supplier Comparison</h3>
      {records.length > 1 && <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table className="wpfTable">
          <thead><tr><th>Supplier</th><th>Cost</th><th>Shipping</th><th>Landed</th><th>Delivery</th><th>MOQ</th><th>Rating</th></tr></thead>
          <tbody>{records.map(r => <tr key={r.id}><td>{r.supplierType}{r.supplierName ? ` (${r.supplierName})` : ""}</td><td>{r.productCost !== null ? money(r.productCost) : "—"}</td><td>{r.shippingCost !== null ? money(r.shippingCost) : "—"}</td><td>{r.productCost !== null && r.shippingCost !== null ? money(r.productCost + r.shippingCost) : "—"}</td><td>{r.deliveryDaysMin !== null && r.deliveryDaysMax !== null ? `${r.deliveryDaysMin}-${r.deliveryDaysMax}d` : "—"}</td><td>{r.moq ?? "—"}</td><td>{r.supplierRating ?? "—"}</td></tr>)}</tbody>
        </table>
      </div>}
      {records.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No suppliers recorded yet.</p>}
      {records.map(r => (
        <div key={r.id} className="wpfResearchRow">
          <div className="fields">
            <div className="field"><label>Supplier type</label><select value={r.supplierType} onChange={e => update(r.id, { supplierType: e.target.value as SupplierType })}>{SUPPLIER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="field"><label>Supplier name</label><input value={r.supplierName} onChange={e => update(r.id, { supplierName: e.target.value })} /></div>
            <div className="field"><label>Product cost</label><input type="number" value={r.productCost ?? ""} onChange={e => update(r.id, { productCost: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Shipping cost</label><input type="number" value={r.shippingCost ?? ""} onChange={e => update(r.id, { shippingCost: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Delivery min days</label><input type="number" value={r.deliveryDaysMin ?? ""} onChange={e => update(r.id, { deliveryDaysMin: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Delivery max days</label><input type="number" value={r.deliveryDaysMax ?? ""} onChange={e => update(r.id, { deliveryDaysMax: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Processing days</label><input type="number" value={r.processingDays ?? ""} onChange={e => update(r.id, { processingDays: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Warehouse</label><input value={r.warehouse} onChange={e => update(r.id, { warehouse: e.target.value })} /></div>
            <div className="field"><label>MOQ</label><input type="number" value={r.moq ?? ""} onChange={e => update(r.id, { moq: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Supplier rating</label><input type="number" value={r.supplierRating ?? ""} onChange={e => update(r.id, { supplierRating: e.target.value === "" ? null : +e.target.value })} /></div>
            <div className="field"><label>Sample status</label><select value={r.sampleStatus} onChange={e => update(r.id, { sampleStatus: e.target.value as SupplierOption["sampleStatus"] })}><option>Not requested</option><option>Requested</option><option>Received</option><option>Approved</option></select></div>
            <div className="field"><label>Last verified</label><input type="date" value={r.lastVerified ?? ""} onChange={e => update(r.id, { lastVerified: e.target.value })} /></div>
            <div className="field wpfCheckRow"><label className="checklistItem"><input type="checkbox" checked={r.brandingOptions} onChange={e => update(r.id, { brandingOptions: e.target.checked })} /><span>Branding options</span></label><label className="checklistItem"><input type="checkbox" checked={r.packagingOptions} onChange={e => update(r.id, { packagingOptions: e.target.checked })} /><span>Packaging options</span></label></div>
            <div className="field full"><label>Refund policy</label><input value={r.refundPolicy} onChange={e => update(r.id, { refundPolicy: e.target.value })} /></div>
            <div className="field full"><label>Notes</label><input value={r.notes} onChange={e => update(r.id, { notes: e.target.value })} /></div>
          </div>
          <button className="secondary" onClick={() => remove(r.id)}>Remove</button>
        </div>
      ))}
      <button className="secondary" onClick={add} style={{ marginTop: 8 }}>+ Add Supplier</button>
    </div>
  );
}

// --- Score Factor Overrides ---
const FACTOR_LABELS: { key: ScoreFactorKey; label: string; max: number }[] = [
  { key: "demandTrend", label: "Demand Trend", max: 20 }, { key: "socialMomentum", label: "Social Momentum", max: 15 },
  { key: "profitPotential", label: "Profit Potential", max: 15 }, { key: "competition", label: "Competition", max: 10 },
  { key: "demoPotential", label: "Demo Potential", max: 10 }, { key: "problemSolving", label: "Problem Solving", max: 10 },
  { key: "fortFit", label: "Fort Fit", max: 10 }, { key: "shippingSupplier", label: "Shipping & Supplier", max: 5 },
  { key: "customerSentiment", label: "Customer Sentiment", max: 5 }
];

export function ScoreOverridePanel({ product }: { product: ProductOpportunity }) {
  const [overrides, setOverrides] = useState(() => scoreOverrideStore.getFor(product.id));
  const overrideFor = (key: ScoreFactorKey) => overrides.find(o => o.factor === key);
  const refresh = () => setOverrides(scoreOverrideStore.getFor(product.id));

  const overriddenTotal = FACTOR_LABELS.reduce((sum, f) => {
    const o = overrideFor(f.key);
    return sum + (o && o.manualValue !== null ? o.manualValue : product.score[f.key]);
  }, 0);

  return (
    <div className="merchBlock"><h3>Score Factor Overrides</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Automated score: {product.score.total}/100. {overriddenTotal !== product.score.total && `With manual overrides: ${Math.round(overriddenTotal)}/100.`}</p>
      {FACTOR_LABELS.map(f => {
        const o = overrideFor(f.key);
        return (
          <div key={f.key} className="wpfResearchRow">
            <div className="fields">
              <div className="field"><label>{f.label} (automated: {product.score[f.key]}/{f.max})</label>
                <input type="number" max={f.max} min={0} placeholder="use automated" value={o?.manualValue ?? ""} onChange={e => {
                  const v = e.target.value === "" ? null : +e.target.value;
                  setScoreOverride(product.id, f.key, { manualValue: v, explanation: o?.explanation ?? "", confidence: o?.confidence ?? "medium", lastUpdated: new Date().toISOString() });
                  refresh();
                }} />
              </div>
              <div className="field full"><label>Explanation</label>
                <input value={o?.explanation ?? ""} onChange={e => {
                  setScoreOverride(product.id, f.key, { manualValue: o?.manualValue ?? null, explanation: e.target.value, confidence: o?.confidence ?? "medium", lastUpdated: new Date().toISOString() });
                  refresh();
                }} />
              </div>
              {o && <button className="secondary" onClick={() => { clearScoreOverride(product.id, f.key); refresh(); }}>Clear override</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
