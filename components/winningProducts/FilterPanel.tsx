"use client";
import { CompetitionLevel, DiscoverFilters, FORT_CATEGORIES, SeasonalRelevance, SourceId, TrendStage } from "@/lib/winningProducts/types";

const SOURCE_OPTIONS: { id: SourceId | "all"; label: string }[] = [
  { id: "all", label: "All sources" }, { id: "google_trends", label: "Google Trends" }, { id: "google_shopping", label: "Google Shopping" },
  { id: "amazon", label: "Amazon" }, { id: "cjdropshipping", label: "CJdropshipping" }, { id: "zendrop", label: "Zendrop" }, { id: "creator_blogs", label: "Creator Blogs" }, { id: "aliexpress", label: "AliExpress" },
  { id: "shopify_supplier_feed", label: "Shopify Supplier Feed" }, { id: "mavely", label: "Mavely" }, { id: "pinterest", label: "Pinterest" },
  { id: "tiktok", label: "TikTok" }, { id: "meta_ad_library", label: "Meta Ad Library" }, { id: "reddit", label: "Reddit" },
  { id: "youtube", label: "YouTube" }, { id: "etsy", label: "Etsy" }, { id: "csv_upload", label: "CSV Upload" }
];

const TREND_STAGES: TrendStage[] = ["Emerging", "Gaining Momentum", "Strong Candidate", "Saturated", "Declining", "Seasonal Opportunity", "Needs More Data"];

export default function FilterPanel({ filters, onChange }: { filters: DiscoverFilters; onChange: (f: DiscoverFilters) => void }) {
  const set = <K extends keyof DiscoverFilters>(key: K, value: DiscoverFilters[K]) => onChange({ ...filters, [key]: value });
  return (
    <div className="fields">
      <div className="field"><label>Category</label>
        <select value={filters.category} onChange={e => set("category", e.target.value as DiscoverFilters["category"])}>
          <option value="all">All categories</option>
          {FORT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="field"><label>Source</label>
        <select value={filters.source} onChange={e => set("source", e.target.value as DiscoverFilters["source"])}>
          {SOURCE_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div className="field"><label>Supplier</label><input value={filters.supplier} onChange={e => set("supplier", e.target.value)} placeholder="Any supplier" /></div>
      <div className="field"><label>Country</label><input value={filters.country} onChange={e => set("country", e.target.value)} /></div>
      <div className="field"><label>Min selling price</label><input type="number" value={filters.minPrice ?? ""} onChange={e => set("minPrice", e.target.value === "" ? null : +e.target.value)} /></div>
      <div className="field"><label>Max selling price</label><input type="number" value={filters.maxPrice ?? ""} onChange={e => set("maxPrice", e.target.value === "" ? null : +e.target.value)} /></div>
      <div className="field"><label>Min profit margin %</label><input type="number" value={filters.minMargin ?? ""} onChange={e => set("minMargin", e.target.value === "" ? null : +e.target.value)} /></div>
      <div className="field"><label>Max supplier cost</label><input type="number" value={filters.maxCost ?? ""} onChange={e => set("maxCost", e.target.value === "" ? null : +e.target.value)} /></div>
      <div className="field"><label>Max shipping days</label><input type="number" value={filters.maxShippingDays ?? ""} onChange={e => set("maxShippingDays", e.target.value === "" ? null : +e.target.value)} /></div>
      <div className="field"><label>Competition level</label>
        <select value={filters.competition} onChange={e => set("competition", e.target.value as CompetitionLevel | "all")}>
          <option value="all">Any</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
      </div>
      <div className="field"><label>Trend stage</label>
        <select value={filters.trendStage} onChange={e => set("trendStage", e.target.value as TrendStage | "all")}>
          <option value="all">Any</option>{TREND_STAGES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="field"><label>Seasonal or evergreen</label>
        <select value={filters.seasonal} onChange={e => set("seasonal", e.target.value as SeasonalRelevance | "all")}>
          <option value="all">Either</option><option value="evergreen">Evergreen</option><option value="seasonal">Seasonal</option>
        </select>
      </div>
      <div className="field"><label>Minimum Fort Score</label><input type="number" value={filters.minFortScore ?? ""} onChange={e => set("minFortScore", e.target.value === "" ? null : +e.target.value)} /></div>
      <div className="field full wpfCheckRow">
        <label className="checklistItem"><input type="checkbox" checked={filters.familyFriendlyOnly} onChange={e => set("familyFriendlyOnly", e.target.checked)} /><span>Family-friendly only</span></label>
        <label className="checklistItem"><input type="checkbox" checked={filters.problemSolvingOnly} onChange={e => set("problemSolvingOnly", e.target.checked)} /><span>Problem-solving products</span></label>
        <label className="checklistItem"><input type="checkbox" checked={filters.demonstrableOnly} onChange={e => set("demonstrableOnly", e.target.checked)} /><span>Demonstrable products</span></label>
        <label className="checklistItem"><input type="checkbox" checked={filters.impulseBuyOnly} onChange={e => set("impulseBuyOnly", e.target.checked)} /><span>Impulse-buy products</span></label>
      </div>
    </div>
  );
}
