"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CompetitionLevel, DEFAULT_FILTERS, DiscoverFilters, FORT_CATEGORIES, ProductOpportunity, ProductStatus, ScanRecord, SortKey
} from "@/lib/winningProducts/types";
import { emptyChecklist } from "@/lib/types";
import {
  addToWatchlist, clearAllData, getHistory, getLastResults, getLastScan, getSettings, getWatchlist, recordScan,
  removeFromWatchlist, saveLastResults, saveLastScan, saveSettings, setProductStatus, updateWatchlistSnapshot,
  upsertProducts, WpfSettings
} from "@/lib/winningProducts/storage";
import { csvAdapterResult, parseSupplierCsv } from "@/lib/winningProducts/adapters/csv";
import { money, pct, signalText, timeAgo } from "@/lib/winningProducts/format";
import ProductCard from "./ProductCard";
import ProductDrawer from "./ProductDrawer";
import FilterPanel from "./FilterPanel";
import SettingsPanel from "./SettingsPanel";
import { MockTag, statusLabel } from "./shared";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Highest winning score" }, { key: "fortFit", label: "Highest Fort Fit" },
  { key: "growth", label: "Fastest growth" }, { key: "margin", label: "Highest margin" },
  { key: "competition", label: "Lowest competition" }, { key: "shipping", label: "Fastest shipping" },
  { key: "recent", label: "Most recently detected" }, { key: "cost", label: "Lowest supplier cost" }
];

const compRank = (c: CompetitionLevel) => c === "low" ? 0 : c === "medium" ? 1 : 2;

function applyFilters(list: ProductOpportunity[], f: DiscoverFilters): ProductOpportunity[] {
  return list.filter(p => {
    if (f.category !== "all" && p.category !== f.category) return false;
    if (f.source !== "all" && p.source !== f.source) return false;
    if (f.supplier && !(p.supplier || "").toLowerCase().includes(f.supplier.toLowerCase())) return false;
    if (f.minPrice !== null && (p.retailPrice.value ?? -Infinity) < f.minPrice) return false;
    if (f.maxPrice !== null && (p.retailPrice.value ?? Infinity) > f.maxPrice) return false;
    if (f.minMargin !== null && (p.estimatedMargin ?? -Infinity) < f.minMargin) return false;
    if (f.maxCost !== null && (p.supplierCost.value ?? Infinity) > f.maxCost) return false;
    if (f.maxShippingDays !== null && (p.shippingDays.value ?? Infinity) > f.maxShippingDays) return false;
    if (f.competition !== "all" && p.competitionLevel !== f.competition) return false;
    if (f.trendStage !== "all" && p.trendStage !== f.trendStage) return false;
    if (f.seasonal !== "all" && p.seasonalRelevance !== f.seasonal) return false;
    if (f.familyFriendlyOnly && !p.familyFriendly) return false;
    if (f.problemSolvingOnly && !p.problemSolving) return false;
    if (f.demonstrableOnly && !p.demonstrable) return false;
    if (f.impulseBuyOnly && !p.impulseFriendly) return false;
    if (f.minFortScore !== null && p.score.total < f.minFortScore) return false;
    return true;
  });
}

function sortProducts(list: ProductOpportunity[], key: SortKey): ProductOpportunity[] {
  const arr = [...list];
  switch (key) {
    case "score": return arr.sort((a, b) => b.score.total - a.score.total);
    case "fortFit": return arr.sort((a, b) => b.fortFit.total - a.fortFit.total);
    case "growth": return arr.sort((a, b) => b.score.demandTrend - a.score.demandTrend);
    case "margin": return arr.sort((a, b) => (b.estimatedMargin ?? -1) - (a.estimatedMargin ?? -1));
    case "competition": return arr.sort((a, b) => compRank(a.competitionLevel) - compRank(b.competitionLevel));
    case "shipping": return arr.sort((a, b) => (a.shippingDays.value ?? 999) - (b.shippingDays.value ?? 999));
    case "recent": return arr.sort((a, b) => new Date(b.lastDetected).getTime() - new Date(a.lastDetected).getTime());
    case "cost": return arr.sort((a, b) => (a.supplierCost.value ?? Infinity) - (b.supplierCost.value ?? Infinity));
    default: return arr;
  }
}

function exportCsv(list: ProductOpportunity[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const headers = ["Title", "URL", "Source", "Supplier", "Category", "Supplier Cost", "Retail Price", "Estimated Profit", "Estimated Margin", "Shipping Days", "Competition", "Trend Stage", "Winning Score", "Fort Fit", "Confidence", "First Detected"];
  const rows = list.map(p => [p.title, p.url, p.source, p.supplier, p.category, p.supplierCost.value, p.retailPrice.value, p.estimatedProfit, p.estimatedMargin, p.shippingDays.value, p.competitionLevel, p.trendStage, p.score.total, p.fortFit.total, p.confidence, p.firstDetected]);
  const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "winning-products.csv";
  a.click();
}

export default function WinningProducts() {
  const router = useRouter();
  const [view, setView] = useState<"discover" | "watchlist" | "history">("discover");
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_FILTERS);
  const [results, setResults] = useState<ProductOpportunity[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<ScanRecord | null>(null);
  const [selected, setSelected] = useState<ProductOpportunity | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [hideMock, setHideMock] = useState(true);
  const [settings, setSettings] = useState<WpfSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<ProductOpportunity[]>([]);
  const [message, setMessage] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSettings(getSettings());
    setHistory(getHistory());
    setWatchedIds(new Set(getWatchlist().map(w => w.productId)));
    setResults(getLastResults());
    setLastScan(getLastScan());
  }, []);
  useEffect(() => { if (settings) saveSettings(settings); }, [settings]);
  // Discover results/last-scan are persisted explicitly at each write site below
  // (runScan, handleCsvFile, clear) rather than via a watcher effect, so the initial
  // load on mount can never race with a premature overwrite.

  const refreshFromStorage = () => { setHistory(getHistory()); setWatchedIds(new Set(getWatchlist().map(w => w.productId))); };

  async function runScan() {
    if (!settings) return;
    setScanning(true); setMessage("");
    const categories = filters.category === "all" ? FORT_CATEGORIES : [filters.category];
    const sourceIds = filters.source === "all"
      ? settings.sources.filter(s => s.enabled && s.id !== "csv_upload").map(s => s.id)
      : (filters.source === "csv_upload" ? [] : [filters.source]);
    if (sourceIds.length === 0) { setMessage("No searchable sources enabled — check Settings, or upload a CSV instead."); setScanning(false); return; }
    try {
      const trimmedKeyword = searchKeyword.trim();
      const r = await fetch("/api/winning-products/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories, sources: sourceIds, limit: 6, weights: settings.weights, keyword: trimmedKeyword || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Scan failed");
      const scored: ProductOpportunity[] = d.results;
      const { merged, newCandidates, updatedExisting } = upsertProducts(scored);
      const displayResults = scored.map(s => merged.find(m => m.matchKeys.canonicalUrl && m.matchKeys.canonicalUrl === s.matchKeys.canonicalUrl) || merged.find(m => m.id === s.id) || s);
      setResults(displayResults);
      saveLastResults(displayResults);
      const watched = new Set(getWatchlist().map(w => w.productId));
      displayResults.forEach(p => { if (watched.has(p.id)) updateWatchlistSnapshot(p); });
      const scan: ScanRecord = { ...d.scan, newCandidates, updatedExisting };
      recordScan(scan);
      setLastScan(scan);
      saveLastScan(scan);
      refreshFromStorage();
      setMessage(`Scan complete — ${d.scan.productsChecked} products checked, ${newCandidates} new, ${updatedExisting} updated.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  function handleCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const { rows, errors } = parseSupplierCsv(text);
      const defaultCategory = filters.category === "all" ? "Everyday Problem Solvers" : filters.category;
      const result = csvAdapterResult(rows, errors, defaultCategory);
      import("@/lib/winningProducts/scoring").then(({ scoreOpportunity }) => {
        const scored = result.products.map(raw => scoreOpportunity(raw, settings?.weights));
        const { merged, newCandidates, updatedExisting } = upsertProducts(scored);
        const displayResults = scored.map(s => merged.find(m => m.id === s.id) || s);
        setResults(displayResults);
        saveLastResults(displayResults);
        refreshFromStorage();
        recordScan({ id: crypto.randomUUID(), startedAt: new Date().toISOString(), durationMs: 0, sourcesSearched: ["csv_upload"], productsChecked: scored.length, newCandidates, updatedExisting, errors: errors.map(m => ({ source: "csv_upload" as const, message: m })) });
        setMessage(`CSV processed — ${scored.length} products loaded (${newCandidates} new, ${updatedExisting} updated).${errors.length ? ` ${errors.length} row issue(s).` : ""}`);
      });
    };
    reader.readAsText(file);
  }

  function toggleWatch(p: ProductOpportunity) {
    if (watchedIds.has(p.id)) removeFromWatchlist(p.id); else addToWatchlist(p);
    refreshFromStorage();
  }

  function markStatus(p: ProductOpportunity, status: ProductStatus) {
    setProductStatus(p.id, status);
    refreshFromStorage();
    setResults(rs => { const next = rs.map(r => r.id === p.id ? { ...r, status } : r); saveLastResults(next); return next; });
    setSelected(s => s && s.id === p.id ? { ...s, status } : s);
  }

  function sendToStudio(p: ProductOpportunity) {
    const demoFactor = p.demoPotential === "high" ? 8 : p.demoPotential === "medium" ? 5 : 3;
    const isAmazon = p.source === "amazon";
    const handoff = {
      url: p.url, name: p.title, cost: p.supplierCost.value ?? 0,
      price: p.aiSummary.suggestedRetailPrice || p.retailPrice.value || 0,
      category: p.category === "Uncategorized" ? "" : p.category,
      audience: p.targetAudience, problem: p.problemSolved, features: "",
      shippingDays: p.shippingDays.value ?? 7, competition: p.competitionLevel, demoFactor,
      productType: isAmazon ? "amazon_affiliate" as const : "dropshipping" as const,
      amazonUrl: isAmazon ? p.url : "", affiliateUrl: "",
      isAffiliateProduct: isAmazon, merchant: isAmazon ? "Amazon" : "", affiliateNetwork: isAmazon ? "Amazon Associates" : "",
      vendor: isAmazon ? "Amazon" : "Fort Crazypants", compareAtPrice: 0, fcpVerdict: ""
    };
    localStorage.setItem("fort-handoff", JSON.stringify(handoff));
    router.push("/");
  }

  type LensMatch = { title: string; link: string; source: string | null; thumbnail: string | null; price: number | null };
  const [lensImageUrl, setLensImageUrl] = useState("");
  const [lensSearching, setLensSearching] = useState(false);
  const [lensResults, setLensResults] = useState<LensMatch[]>([]);
  const [lensError, setLensError] = useState("");

  async function runReverseImageSearch() {
    const trimmed = lensImageUrl.trim();
    if (!trimmed) return;
    setLensSearching(true); setLensError(""); setLensResults([]);
    try {
      const r = await fetch("/api/reverse-image-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: trimmed }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Reverse image search failed.");
      setLensResults(d.results || []);
      if (!d.results?.length) setLensError("No visual matches found for this image.");
    } catch (e) {
      setLensError(e instanceof Error ? e.message : "Reverse image search failed.");
    } finally {
      setLensSearching(false);
    }
  }

  function researchLensMatch(m: LensMatch) {
    const isAmazon = /amazon\.[a-z.]+$/i.test(new URL(m.link, "https://example.com").hostname);
    const handoff = {
      url: m.link, name: m.title, cost: 0, price: m.price || 0, category: "", audience: "", problem: "", features: "",
      shippingDays: 7, competition: "medium" as const, demoFactor: 6,
      productType: isAmazon ? "amazon_affiliate" as const : "dropshipping" as const,
      amazonUrl: isAmazon ? m.link : "", affiliateUrl: "",
      isAffiliateProduct: isAmazon, merchant: isAmazon ? "Amazon" : "", affiliateNetwork: isAmazon ? "Amazon Associates" : "",
      vendor: isAmazon ? "Amazon" : "Fort Crazypants", compareAtPrice: 0, fcpVerdict: ""
    };
    localStorage.setItem("fort-handoff", JSON.stringify(handoff));
    router.push("/");
  }

  const [autoBuildingId, setAutoBuildingId] = useState<string | null>(null);

  // One-click pipeline: generate the full listing (title, description, SEO, pricing,
  // category, social prompts) AND render real AI images automatically — stops short of
  // Shopify itself, landing in Product Studio for a human to review and click Publish.
  async function autoBuildAndGenerate(p: ProductOpportunity) {
    setAutoBuildingId(p.id);
    try {
      const demoFactor = p.demoPotential === "high" ? 8 : p.demoPotential === "medium" ? 5 : 3;
      const isAmazon = p.source === "amazon";
      const input = {
        url: p.url, name: p.title, cost: p.supplierCost.value ?? 0,
        price: p.aiSummary.suggestedRetailPrice || p.retailPrice.value || 0,
        category: p.category === "Uncategorized" ? "" : p.category,
        audience: p.targetAudience, problem: p.problemSolved, features: "",
        shippingDays: p.shippingDays.value ?? 7, competition: p.competitionLevel, demoFactor,
        productType: isAmazon ? "amazon_affiliate" as const : "dropshipping" as const,
        amazonUrl: isAmazon ? p.url : "", affiliateUrl: "",
        isAffiliateProduct: isAmazon, merchant: isAmazon ? "Amazon" : "", affiliateNetwork: isAmazon ? "Amazon Associates" : "",
        vendor: isAmazon ? "Amazon" : "Fort Crazypants", compareAtPrice: 0, fcpVerdict: ""
      };
      const genRes = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const generated = await genRes.json();
      if (!genRes.ok) throw new Error(generated.error || "Listing generation failed.");

      // Cap at 3 real image generations per auto-build to keep this fast and bounded — the
      // rest of the AI Image Prompt cards remain available to generate manually in Product Studio.
      const images: Record<string, string> = {};
      for (const ip of generated.imagePrompts.slice(0, 3)) {
        try {
          const r = await fetch("/api/generate-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: ip.prompt, negativePrompt: ip.negativePrompt, aspectRatio: ip.aspectRatio }) });
          const d = await r.json();
          if (r.ok) images[ip.key] = d.imageUrl;
        } catch { /* best-effort — a failed image doesn't block the rest of the auto-build */ }
      }

      const checklist = { ...emptyChecklist(), pinterestCreated: true, instagramGenerated: true, reelGenerated: true, emailGenerated: true, blogGenerated: true, imagesGenerated: Object.keys(images).length > 0 };
      localStorage.setItem("fort-autobuild", JSON.stringify({ generated: { ...generated, checklist }, images }));
      router.push("/");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Auto-build failed.");
    } finally {
      setAutoBuildingId(null);
    }
  }

  const mockCount = results.filter(p => p.isMock).length;
  const filteredResults = useMemo(() => sortProducts(applyFilters(hideMock ? results.filter(p => !p.isMock) : results, filters), sortKey), [results, filters, sortKey, hideMock]);
  const filteredHistory = useMemo(() => sortProducts(applyFilters(hideMock ? history.filter(p => !p.isMock) : history, filters), sortKey), [history, filters, sortKey, hideMock]);

  const bestProduct = filteredResults[0] || null;
  const topFive = filteredResults.slice(0, 5);
  const toWatch = filteredResults.filter(p => p.aiSummary.recommendation === "Add to Watchlist");
  const toAvoid = filteredResults.filter(p => p.aiSummary.recommendation === "Skip" || p.aiSummary.recommendation === "Saturated");
  const readyForStudio = filteredResults.filter(p => p.aiSummary.recommendation === "Test Now");

  const watchlistEntries = getWatchlist();
  const relatedBySource = selected ? history.filter(h => h.id !== selected.id && h.matchKeys.normalizedTitle === selected.matchKeys.normalizedTitle) : [];

  if (!settings) return null;

  return (
    <>
      <div className="top"><div><div className="eyebrow">Internal Research Tool</div><h1 className="title">🔥 Winning Product Finder</h1><div className="muted">Search approved sources for rising-demand products, score them for Fort Crazypants fit, and send winners straight to Product Studio.</div></div>
        <button className="secondary" onClick={() => setShowSettings(true)}>⚙ Settings</button>
      </div>

      <div className="wpfTabs">
        <button className={`tab ${view === "discover" ? "on" : ""}`} onClick={() => setView("discover")}>Discover</button>
        <button className={`tab ${view === "watchlist" ? "on" : ""}`} onClick={() => setView("watchlist")}>Watchlist ({watchlistEntries.length})</button>
        <button className={`tab ${view === "history" ? "on" : ""}`} onClick={() => setView("history")}>Product History ({history.length})</button>
      </div>

      {view === "discover" && <>
        <section className="card">
          <h2>Search for an item</h2>
          <div className="fields">
            <div className="field full">
              <label>Product name or keyword</label>
              <input
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                placeholder="e.g. cordless handheld vacuum"
                onKeyDown={e => { if (e.key === "Enter") runScan(); }}
              />
            </div>
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {searchKeyword.trim() ? `Searches connected sources for "${searchKeyword.trim()}" instead of random category picks.` : "Leave blank to browse by category instead."}
          </div>
        </section>

        <section className="card">
          <h2>Reverse Image Search</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            Paste a product photo's URL (right-click an image → "Copy image address") to find where else it's sold and similar listings, via Google Lens. Direct file upload isn't supported — Google Lens requires a publicly hosted image URL.
          </div>
          <div className="fields">
            <div className="field full">
              <label>Image URL</label>
              <input
                value={lensImageUrl}
                onChange={e => setLensImageUrl(e.target.value)}
                placeholder="https://example.com/product-photo.jpg"
                onKeyDown={e => { if (e.key === "Enter") runReverseImageSearch(); }}
              />
            </div>
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="secondary" onClick={runReverseImageSearch} disabled={lensSearching || !lensImageUrl.trim()}>{lensSearching ? "Searching…" : "🔍 Reverse Image Search"}</button>
          </div>
          {lensError && <div className="status">{lensError}</div>}
          {lensResults.length > 0 && <div className="promptGrid" style={{ marginTop: 14 }}>
            {lensResults.map((m, i) => <div key={i} className="promptCard">
              {m.thumbnail && <img src={m.thumbnail} alt={m.title} style={{ width: "100%", borderRadius: 8, marginBottom: 8 }} />}
              <div style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</div>
              <div className="muted" style={{ fontSize: 13 }}>{m.source || "Unknown source"}{m.price ? ` · $${m.price.toFixed(2)}` : ""}</div>
              <div className="actions" style={{ marginTop: 8 }}>
                <a className="secondary" href={m.link} target="_blank" rel="noreferrer" style={{ textAlign: "center" }}>View listing</a>
                <button className="secondary" onClick={() => researchLensMatch(m)}>Research in Product Studio</button>
              </div>
            </div>)}
          </div>}
        </section>

        <section className="card">
          <h2>Discover Filters</h2>
          <FilterPanel filters={filters} onChange={setFilters} />
          <div className="actions" style={{ marginTop: 16 }}>
            <button className="primary wpfFindButton" onClick={runScan} disabled={scanning}>{scanning ? "Scanning sources…" : searchKeyword.trim() ? `🔎 Search "${searchKeyword.trim()}"` : "🔥 Find Winning Products"}</button>
            <button className="secondary" onClick={() => fileInputRef.current?.click()}>Upload supplier CSV</button>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ""; }} />
            {results.length > 0 && <button className="secondary" onClick={() => exportCsv(filteredResults)}>Export CSV</button>}
          </div>
          {message && <div className="status">{message}</div>}
        </section>

        {lastScan && <section className="card saved"><h2>Scan Summary</h2>
          <div className="metrics">
            <div className="metric"><span className="muted">Sources searched</span><b>{lastScan.sourcesSearched.length}</b></div>
            <div className="metric"><span className="muted">Products checked</span><b>{lastScan.productsChecked}</b></div>
            <div className="metric"><span className="muted">New candidates</span><b>{lastScan.newCandidates}</b></div>
            <div className="metric"><span className="muted">Duration</span><b>{(lastScan.durationMs / 1000).toFixed(1)}s</b></div>
          </div>
          {lastScan.errors.length > 0 && <div className="merchBlock"><h3>Errors</h3><ul>{lastScan.errors.map((e, i) => <li key={i}>{e.source.replace(/_/g, " ")}: {e.message}</li>)}</ul></div>}
          {bestProduct && <div className="merchGrid">
            <div className="merchBlock"><h3>Best Product Found</h3><p className="promptText">{bestProduct.title} — Winning Score {bestProduct.score.total}, Fort Fit {bestProduct.fortFit.total}</p></div>
            <div className="merchBlock"><h3>Top 5 Candidates</h3><ul>{topFive.map(p => <li key={p.id}>{p.title} ({p.score.total})</li>)}</ul></div>
            <div className="merchBlock"><h3>Products to Watch</h3><ul>{toWatch.length ? toWatch.map(p => <li key={p.id}>{p.title}</li>) : <li className="muted">None this scan.</li>}</ul></div>
            <div className="merchBlock"><h3>Products to Avoid</h3><ul>{toAvoid.length ? toAvoid.map(p => <li key={p.id}>{p.title} ({p.aiSummary.recommendation})</li>) : <li className="muted">None this scan.</li>}</ul></div>
            <div className="merchBlock"><h3>Ready for Product Studio</h3><ul>{readyForStudio.length ? readyForStudio.map(p => <li key={p.id}>{p.title}</li>) : <li className="muted">None this scan.</li>}</ul></div>
          </div>}
        </section>}

        <section className="card">
          <div className="wpfResultsHead">
            <h2>Results ({filteredResults.length})</h2>
            <div className="wpfResultsControls">
              <label className="checklistItem" style={{ fontSize: 13 }} title="Mock data looks complete but isn't real — hidden by default so it can't outrank verified results."><input type="checkbox" checked={hideMock} onChange={e => setHideMock(e.target.checked)} /><span>Hide mock data{mockCount > 0 ? ` (${mockCount})` : ""}</span></label>
              <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>{SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
              <button className="secondary" onClick={() => setViewMode(v => v === "grid" ? "table" : "grid")}>{viewMode === "grid" ? "Table view" : "Grid view"}</button>
            </div>
          </div>
          {filteredResults.length === 0 && results.length > 0 && hideMock && <div className="empty"><div style={{ fontSize: 46 }}>🔥</div><h2>No real results yet</h2><p>Only mock data came back from this scan. Uncheck "Hide mock data" to see it, or connect another real source.</p></div>}
          {filteredResults.length === 0 && results.length === 0 && <div className="empty"><div style={{ fontSize: 46 }}>🔥</div><h2>No results yet</h2><p>Click "Find Winning Products" or upload a supplier CSV to get started.</p></div>}
          {viewMode === "grid" && filteredResults.length > 0 && <div className="wpfGrid">{filteredResults.map(p => <ProductCard key={p.id} product={p} isWatched={watchedIds.has(p.id)} onOpen={() => setSelected(p)} onWatch={() => toggleWatch(p)} />)}</div>}
          {viewMode === "table" && filteredResults.length > 0 && <ResultsTable list={filteredResults} onOpen={setSelected} />}
        </section>
      </>}

      {view === "watchlist" && <WatchlistView entries={watchlistEntries} history={history} onOpen={setSelected} onRemove={id => { removeFromWatchlist(id); refreshFromStorage(); }} />}

      {view === "history" && <section className="card">
        <div className="wpfResultsHead"><h2>Product History ({filteredHistory.length})</h2><FilterPanel filters={filters} onChange={setFilters} /></div>
        <HistoryTable list={filteredHistory} onOpen={setSelected} />
      </section>}

      {selected && <ProductDrawer
        product={selected}
        onClose={() => setSelected(null)}
        isWatched={watchedIds.has(selected.id)}
        onWatch={() => toggleWatch(selected)}
        onSendToStudio={() => sendToStudio(selected)}
        onAutoBuild={() => autoBuildAndGenerate(selected)}
        autoBuilding={autoBuildingId === selected.id}
        onSetStatus={status => markStatus(selected, status)}
        onExport={() => exportCsv([selected])}
        relatedBySource={relatedBySource}
      />}

      {showSettings && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} onClearData={() => { clearAllData(); setResults([]); setLastScan(null); refreshFromStorage(); setShowSettings(false); setMessage("All Winning Products data cleared."); }} />}
    </>
  );
}

function ResultsTable({ list, onOpen }: { list: ProductOpportunity[]; onOpen: (p: ProductOpportunity) => void }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="wpfTable">
        <thead><tr><th>Product</th><th>Source</th><th>Cost</th><th>Retail</th><th>Profit</th><th>Margin</th><th>Ship</th><th>Trend</th><th>Score</th><th>Fort Fit</th><th>Competition</th><th>Confidence</th><th>First Seen</th></tr></thead>
        <tbody>{list.map(p => (
          <tr key={p.id} onClick={() => onOpen(p)}>
            <td><b>{p.title}</b> <MockTag isMock={p.isMock} /></td>
            <td>{p.source.replace(/_/g, " ")}</td>
            <td>{signalText(p.supplierCost, v => money(v))}</td>
            <td>{signalText(p.retailPrice, v => money(v))}</td>
            <td>{money(p.estimatedProfit)}</td>
            <td>{pct(p.estimatedMargin)}</td>
            <td>{signalText(p.shippingDays, v => `${v}d`)}</td>
            <td>{p.trendStage}</td>
            <td>{p.score.total}</td>
            <td>{p.fortFit.total}</td>
            <td style={{ textTransform: "capitalize" }}>{p.competitionLevel}</td>
            <td>{p.confidence}</td>
            <td>{new Date(p.firstDetected).toLocaleDateString()}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function HistoryTable({ list, onOpen }: { list: ProductOpportunity[]; onOpen: (p: ProductOpportunity) => void }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="wpfTable">
        <thead><tr><th>Product</th><th>Status</th><th>Score</th><th>First Seen</th><th>Last Seen</th><th>Times Seen</th></tr></thead>
        <tbody>{list.map(p => (
          <tr key={p.id} onClick={() => onOpen(p)}>
            <td><b>{p.title}</b></td>
            <td>{statusLabel(p.status)}</td>
            <td>{p.score.total}</td>
            <td>{new Date(p.firstDetected).toLocaleDateString()} ({timeAgo(p.firstDetected)})</td>
            <td>{new Date(p.lastDetected).toLocaleDateString()} ({timeAgo(p.lastDetected)})</td>
            <td>{p.firstDetected === p.lastDetected ? "1" : "2+"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function WatchlistView({ entries, history, onOpen, onRemove }: { entries: ReturnType<typeof getWatchlist>; history: ProductOpportunity[]; onOpen: (p: ProductOpportunity) => void; onRemove: (id: string) => void }) {
  if (entries.length === 0) return <section className="card"><div className="empty"><div style={{ fontSize: 46 }}>☆</div><h2>Nothing on your watchlist yet</h2><p>Add products from Discover to track how they change over time.</p></div></section>;
  return (
    <section className="card">
      <h2>Watchlist</h2>
      {entries.map(entry => {
        const product = history.find(h => h.id === entry.productId);
        if (!product) return null;
        const first = entry.snapshots[0];
        const last = entry.snapshots[entry.snapshots.length - 1];
        const scoreChange = last.score - first.score;
        const priceChange = (last.retailPrice ?? 0) - (first.retailPrice ?? 0);
        return (
          <div key={entry.productId} className="wpfWatchRow">
            <div onClick={() => onOpen(product)} style={{ cursor: "pointer" }}>
              <b>{product.title}</b>
              <div className="muted" style={{ fontSize: 12 }}>Added {timeAgo(entry.addedAt)} · Last checked {timeAgo(last.capturedAt)}</div>
              <div className="pillRow" style={{ marginTop: 6 }}>
                <span className="badge">Score {last.score} ({scoreChange >= 0 ? "+" : ""}{scoreChange})</span>
                <span className="badge">Price {priceChange === 0 ? "unchanged" : `${priceChange > 0 ? "+" : ""}${priceChange.toFixed(2)}`}</span>
                <span className="badge">{scoreChange > 0 ? "📈 trending up" : scoreChange < 0 ? "📉 trending down" : "➖ flat"}</span>
              </div>
              {entry.alerts.length > 0 && <ul style={{ marginTop: 6 }}>{entry.alerts.slice(0, 3).map((a, i) => <li key={i} className={a.severity === "warning" ? "" : ""}>{a.severity === "positive" ? "✅" : a.severity === "warning" ? "⚠️" : "ℹ️"} {a.message} <span className="muted">({timeAgo(a.at)})</span></li>)}</ul>}
            </div>
            <button className="secondary" onClick={() => onRemove(entry.productId)}>Remove</button>
          </div>
        );
      })}
    </section>
  );
}
