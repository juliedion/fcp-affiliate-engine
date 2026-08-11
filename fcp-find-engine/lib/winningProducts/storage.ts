import { findDuplicate } from "./dedupe";
import { DEFAULT_SOURCES, DEFAULT_WEIGHTS, ProductOpportunity, ProductStatus, ScanRecord, ScheduleSettings, ScoreWeights, SourceConfig, WatchlistAlert, WatchlistEntry, WatchlistSnapshot } from "./types";

const KEYS = {
  history: "fort-wpf-history",
  watchlist: "fort-wpf-watchlist",
  scans: "fort-wpf-scans",
  settings: "fort-wpf-settings",
  lastResults: "fort-wpf-last-results",
  lastScan: "fort-wpf-last-scan"
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

export function getHistory(): ProductOpportunity[] { return read<ProductOpportunity[]>(KEYS.history, []); }
export function saveHistory(items: ProductOpportunity[]) { write(KEYS.history, items); }

// Persists the Discover tab's current result set and last scan summary, so navigating
// away (including the browser back button, which remounts the page) doesn't lose them.
export function getLastResults(): ProductOpportunity[] { return read<ProductOpportunity[]>(KEYS.lastResults, []); }
export function saveLastResults(items: ProductOpportunity[]) { write(KEYS.lastResults, items); }
export function getLastScan(): ScanRecord | null { return read<ScanRecord | null>(KEYS.lastScan, null); }
export function saveLastScan(scan: ScanRecord | null) { write(KEYS.lastScan, scan); }

// Merges freshly-scanned products into history, deduping against everything seen before.
// Returns counts for the scan record and the merged, de-duplicated product set for display.
export function upsertProducts(freshlyScanned: ProductOpportunity[]): { merged: ProductOpportunity[]; newCandidates: number; updatedExisting: number } {
  const history = getHistory();
  let newCandidates = 0;
  let updatedExisting = 0;
  const merged: ProductOpportunity[] = [...history];

  for (const candidate of freshlyScanned) {
    const dupe = findDuplicate(merged, candidate);
    if (dupe) {
      updatedExisting++;
      const idx = merged.findIndex(p => p.id === dupe.id);
      merged[idx] = { ...dupe, ...candidate, id: dupe.id, firstDetected: dupe.firstDetected, lastDetected: candidate.lastDetected, status: dupe.status };
    } else {
      newCandidates++;
      merged.push(candidate);
    }
  }

  saveHistory(merged);
  return { merged, newCandidates, updatedExisting };
}

export function setProductStatus(id: string, status: ProductStatus) {
  const history = getHistory();
  const idx = history.findIndex(p => p.id === id);
  if (idx === -1) return;
  history[idx] = { ...history[idx], status };
  saveHistory(history);
}

export function getWatchlist(): WatchlistEntry[] { return read<WatchlistEntry[]>(KEYS.watchlist, []); }
export function saveWatchlist(items: WatchlistEntry[]) { write(KEYS.watchlist, items); }

function buildSnapshot(p: ProductOpportunity): WatchlistSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    searchTrend: p.searchTrend.value,
    reviewCount: p.reviewCount.value,
    rating: p.rating.value,
    supplierCost: p.supplierCost.value,
    retailPrice: p.retailPrice.value,
    competitionLevel: p.competitionLevel,
    socialEngagement: p.socialEngagement.value,
    adActivity: p.adActivity.value,
    shippingDays: p.shippingDays.value,
    score: p.score.total
  };
}

export function addToWatchlist(product: ProductOpportunity) {
  const list = getWatchlist();
  if (list.some(w => w.productId === product.id)) return;
  list.push({ productId: product.id, addedAt: new Date().toISOString(), snapshots: [buildSnapshot(product)], alerts: [] });
  saveWatchlist(list);
  setProductStatus(product.id, "watchlisted");
}

export function removeFromWatchlist(productId: string) {
  saveWatchlist(getWatchlist().filter(w => w.productId !== productId));
}

function diffAlerts(prev: WatchlistSnapshot, next: WatchlistSnapshot): WatchlistAlert[] {
  const alerts: WatchlistAlert[] = [];
  const now = new Date().toISOString();
  const scoreDelta = next.score - prev.score;
  if (scoreDelta >= 10) alerts.push({ message: `Score increased by ${scoreDelta} points`, severity: "positive", at: now });
  if (scoreDelta <= -10) alerts.push({ message: `Score dropped by ${Math.abs(scoreDelta)} points`, severity: "warning", at: now });
  if (prev.supplierCost !== null && next.supplierCost !== null && next.supplierCost < prev.supplierCost) alerts.push({ message: "Supplier cost dropped", severity: "positive", at: now });
  if (prev.shippingDays !== null && next.shippingDays !== null && next.shippingDays < prev.shippingDays) alerts.push({ message: "Shipping time improved", severity: "positive", at: now });
  if (prev.competitionLevel !== "high" && next.competitionLevel === "high") alerts.push({ message: "Competition increased sharply", severity: "warning", at: now });
  if (prev.score < 55 && next.score >= 65) alerts.push({ message: "Search demand is rising", severity: "positive", at: now });
  if (next.score < 40 && next.competitionLevel === "high") alerts.push({ message: "Product appears saturated", severity: "warning", at: now });
  return alerts;
}

// Called after a scan re-detects a watched product — appends a snapshot and computes alerts by diffing against the last one.
export function updateWatchlistSnapshot(product: ProductOpportunity) {
  const list = getWatchlist();
  const idx = list.findIndex(w => w.productId === product.id);
  if (idx === -1) return;
  const entry = list[idx];
  const prev = entry.snapshots[entry.snapshots.length - 1];
  const next = buildSnapshot(product);
  const alerts = prev ? diffAlerts(prev, next) : [];
  list[idx] = { ...entry, snapshots: [...entry.snapshots, next], alerts: [...alerts, ...entry.alerts].slice(0, 20) };
  saveWatchlist(list);
}

export function getScans(): ScanRecord[] { return read<ScanRecord[]>(KEYS.scans, []); }
export function recordScan(scan: ScanRecord) { write(KEYS.scans, [scan, ...getScans()].slice(0, 50)); }

export type WpfSettings = { weights: ScoreWeights; sources: SourceConfig[]; schedule: ScheduleSettings };
const DEFAULT_SETTINGS: WpfSettings = {
  weights: DEFAULT_WEIGHTS,
  sources: DEFAULT_SOURCES,
  schedule: { frequency: "manual", categories: [], sources: DEFAULT_SOURCES.filter(s => s.enabled).map(s => s.id), lastRunAt: null }
};

export function getSettings(): WpfSettings {
  const stored = read<Partial<WpfSettings>>(KEYS.settings, {});
  // Merge in any source added to DEFAULT_SOURCES after this browser last saved its
  // settings — otherwise a newly-connected source (e.g. Zendrop) silently never
  // appears because the stale persisted list wins outright.
  const storedIds = new Set((stored.sources ?? []).map(s => s.id));
  const missingDefaults = DEFAULT_SETTINGS.sources.filter(s => !storedIds.has(s.id));
  const sources = stored.sources?.length ? [...stored.sources, ...missingDefaults] : DEFAULT_SETTINGS.sources;
  return {
    weights: { ...DEFAULT_SETTINGS.weights, ...stored.weights },
    sources,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...stored.schedule }
  };
}
export function saveSettings(settings: WpfSettings) { write(KEYS.settings, settings); }

// Clears history/watchlist/scans (not settings) — useful after a data-model bug fix
// leaves stale/incorrectly-deduped entries in localStorage from before the fix.
export function clearAllData() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEYS.history);
  localStorage.removeItem(KEYS.watchlist);
  localStorage.removeItem(KEYS.scans);
  localStorage.removeItem(KEYS.lastResults);
  localStorage.removeItem(KEYS.lastScan);
}
