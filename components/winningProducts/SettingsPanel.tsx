"use client";
import { FORT_CATEGORIES, FortCategory, ScheduleFrequency, SourceConfig, SourceId } from "@/lib/winningProducts/types";
import { clearAllData, WpfSettings } from "@/lib/winningProducts/storage";

const WEIGHT_LABELS: { key: keyof WpfSettings["weights"]; label: string }[] = [
  { key: "demandTrend", label: "Demand Trend" }, { key: "socialMomentum", label: "Social Momentum" },
  { key: "profitPotential", label: "Profit Potential" }, { key: "competition", label: "Competition" },
  { key: "demoPotential", label: "Demo Potential" }, { key: "problemSolving", label: "Problem Solving" },
  { key: "fortFit", label: "Fort Crazypants Brand Fit" }, { key: "shippingSupplier", label: "Shipping & Supplier Quality" },
  { key: "customerSentiment", label: "Customer Sentiment" }
];

export default function SettingsPanel({ settings, onChange, onClose, onClearData }: { settings: WpfSettings; onChange: (s: WpfSettings) => void; onClose: () => void; onClearData: () => void }) {
  const weightTotal = Object.values(settings.weights).reduce((a, b) => a + b, 0);
  const setWeight = (key: keyof WpfSettings["weights"], value: number) => onChange({ ...settings, weights: { ...settings.weights, [key]: value } });
  const toggleSource = (id: SourceId) => onChange({ ...settings, sources: settings.sources.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s) });
  const setSchedule = (patch: Partial<WpfSettings["schedule"]>) => onChange({ ...settings, schedule: { ...settings.schedule, ...patch } });
  const toggleScheduleCategory = (cat: FortCategory) => {
    const has = settings.schedule.categories.includes(cat);
    setSchedule({ categories: has ? settings.schedule.categories.filter(c => c !== cat) : [...settings.schedule.categories, cat] });
  };

  return (
    <div className="wpfDrawerOverlay" onClick={onClose}>
      <div className="wpfDrawer" onClick={e => e.stopPropagation()}>
        <button className="secondary wpfDrawerClose" onClick={onClose}>Close ✕</button>
        <h2>Winning Product Finder Settings</h2>

        <div className="merchBlock"><h3>Scoring Weights {weightTotal !== 100 && <span className="badge" style={{ marginLeft: 8 }}>Sums to {weightTotal}, not 100 — scores auto-normalize</span>}</h3>
          <div className="fields">
            {WEIGHT_LABELS.map(w => <div className="field" key={w.key}><label>{w.label}: {settings.weights[w.key]}%</label><input type="range" min={0} max={40} value={settings.weights[w.key]} onChange={e => setWeight(w.key, +e.target.value)} /></div>)}
          </div>
        </div>

        <div className="merchBlock"><h3>Data Sources</h3>
          <div className="checklist">
            {settings.sources.map((s: SourceConfig) => (
              <label key={s.id} className="checklistItem" title={s.notes}>
                <input type="checkbox" checked={s.enabled} onChange={() => toggleSource(s.id)} />
                <span>{s.label}{s.requiresApiKey && !s.connected ? " (mock — no API key)" : ""}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="merchBlock"><h3>Scheduled Research</h3>
          <div className="field"><label>Frequency</label>
            <select value={settings.schedule.frequency} onChange={e => setSchedule({ frequency: e.target.value as ScheduleFrequency })}>
              <option value="manual">Manual scan only</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
            </select>
          </div>
          {settings.schedule.frequency !== "manual" && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            This app has no background server process, so a scheduled scan runs automatically the next time you open Winning Products after the interval elapses (or trigger a manual scan any time).
          </div>}
          <div style={{ marginTop: 10 }}><span className="muted" style={{ fontSize: 12 }}>Categories included in scheduled scans:</span>
            <div className="checklist" style={{ marginTop: 6 }}>
              {FORT_CATEGORIES.map(c => <label key={c} className="checklistItem"><input type="checkbox" checked={settings.schedule.categories.includes(c)} onChange={() => toggleScheduleCategory(c)} /><span>{c}</span></label>)}
            </div>
          </div>
          {settings.schedule.lastRunAt && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Last scheduled run: {new Date(settings.schedule.lastRunAt).toLocaleString()}</div>}
        </div>

        <div className="merchBlock"><h3>Reset Data</h3>
          <p className="promptText" style={{ marginBottom: 10 }}>Clears saved Discover results, Watchlist, and Product History (not Settings). Useful after a data-model change, or just to start clean.</p>
          <button className="secondary" onClick={() => { if (confirm("Clear all Winning Products history, watchlist, and scan data? This can't be undone.")) onClearData(); }}>Clear all Winning Products data</button>
        </div>
      </div>
    </div>
  );
}
