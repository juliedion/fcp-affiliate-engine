"use client";
import { useState } from "react";
import { ProductOpportunity } from "@/lib/winningProducts/types";
import { money, pct, signalText, timeAgo } from "@/lib/winningProducts/format";
import { BadgeRow, ConfidenceTag, MockTag, statusLabel } from "./shared";
import { CompetitorPanel, ProfitabilityPanel, ScoreOverridePanel, SupplierPanel, TrendEvidencePanel } from "./ResearchPanels";

type DrawerTab = "overview" | "profitability" | "trend" | "suppliers" | "competitors" | "scoring";
const DRAWER_TABS: { key: DrawerTab; label: string }[] = [
  { key: "overview", label: "Overview" }, { key: "profitability", label: "Profitability" },
  { key: "trend", label: "Trend Evidence" }, { key: "suppliers", label: "Suppliers" },
  { key: "competitors", label: "Competitors" }, { key: "scoring", label: "Score Overrides" }
];

export default function ProductDrawer({
  product, onClose, onWatch, isWatched, onSendToStudio, onAutoBuild, autoBuilding, onSetStatus, onExport, relatedBySource
}: {
  product: ProductOpportunity;
  onClose: () => void;
  onWatch: () => void;
  isWatched: boolean;
  onSendToStudio: () => void;
  onAutoBuild: () => void;
  autoBuilding: boolean;
  onSetStatus: (status: ProductOpportunity["status"]) => void;
  onExport: () => void;
  relatedBySource: ProductOpportunity[];
}) {
  const p = product;
  const [tab, setTab] = useState<DrawerTab>("overview");
  return (
    <div className="wpfDrawerOverlay" onClick={onClose}>
      <div className="wpfDrawer" onClick={e => e.stopPropagation()}>
        <button className="secondary wpfDrawerClose" onClick={onClose}>Close ✕</button>
        <div className="wpfDrawerHead">
          <div className="wpfDrawerImage">{p.image ? <img src={p.image} alt="" /> : <div className="wpfCardImagePlaceholder">No image</div>}</div>
          <div>
            <h2 style={{ margin: "0 0 6px" }}>{p.title}</h2>
            <div className="muted" style={{ fontSize: 13 }}>{p.source.replace(/_/g, " ")} · {p.supplier || "Unknown supplier"} · {p.category}</div>
            <div className="pillRow" style={{ marginTop: 8 }}><ConfidenceTag confidence={p.confidence} /><MockTag isMock={p.isMock} /><span className="badge">{statusLabel(p.status)}</span></div>
          </div>
        </div>

        <div className="wpfTabs" style={{ marginTop: 16 }}>{DRAWER_TABS.map(t => <button key={t.key} className={`tab ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>

        {tab === "profitability" && <ProfitabilityPanel product={p} />}
        {tab === "trend" && <TrendEvidencePanel productId={p.id} />}
        {tab === "suppliers" && <SupplierPanel productId={p.id} />}
        {tab === "competitors" && <CompetitorPanel productId={p.id} />}
        {tab === "scoring" && <ScoreOverridePanel product={p} />}

        {tab === "overview" && <>
        <div className="metrics" style={{ marginTop: 16 }}>
          <div className="metric"><span className="muted">Winning Score</span><b>{p.score.total}/100</b></div>
          <div className="metric"><span className="muted">Fort Fit Score</span><b>{p.fortFit.total}/100</b></div>
          <div className="metric"><span className="muted">Confidence</span><b style={{ textTransform: "capitalize" }}>{p.confidence}</b></div>
        </div>

        <div className="merchBlock"><h3>Winning Product Score Breakdown</h3>
          <ul>
            <li>Demand Trend: {p.score.demandTrend}/20</li>
            <li>Social Momentum: {p.score.socialMomentum}/15</li>
            <li>Profit Potential: {p.score.profitPotential}/15</li>
            <li>Competition: {p.score.competition}/10</li>
            <li>Demo Potential: {p.score.demoPotential}/10</li>
            <li>Problem Solving: {p.score.problemSolving}/10</li>
            <li>Fort Fit: {p.score.fortFit}/10</li>
            <li>Shipping &amp; Supplier: {p.score.shippingSupplier}/5</li>
            <li>Customer Sentiment: {p.score.customerSentiment}/5</li>
          </ul>
        </div>

        <div className="merchBlock"><h3>Fort Fit Breakdown</h3><p className="promptText">{p.fortFit.explanation}</p></div>

        <div className="merchGrid">
          <div className="merchBlock"><h3>Price Comparison</h3>
            <ul>
              <li>Supplier cost: {signalText(p.supplierCost, v => money(v))}</li>
              <li>Current retail: {signalText(p.retailPrice, v => money(v))}</li>
              <li>Suggested selling price: {money(p.aiSummary.suggestedRetailPrice)}</li>
              <li>Estimated profit: {money(p.estimatedProfit)}</li>
              <li>Estimated margin: {pct(p.estimatedMargin)}</li>
            </ul>
          </div>
          <div className="merchBlock"><h3>Supplier &amp; Shipping</h3>
            <ul>
              <li>Supplier: {p.supplier || "Not enough verified data."}</li>
              <li>Shipping time: {signalText(p.shippingDays, v => `${v} days`)}</li>
              <li>Competition: {p.competitionLevel} ({signalText(p.competingSellers, v => `${v} sellers`)})</li>
              <li>Trend stage: {p.trendStage}</li>
            </ul>
          </div>
        </div>

        <div className="merchGrid">
          <div className="merchBlock"><h3>Trend Signal</h3>
            <ul>
              <li>Search interest: {signalText(p.searchTrend, v => v)}</li>
              <li>Review growth: {signalText(p.reviewGrowth, v => v)}</li>
              <li>Rating: {signalText(p.rating, v => `${v}★`)} ({signalText(p.reviewCount, v => `${v} reviews`)})</li>
            </ul>
          </div>
          <div className="merchBlock"><h3>Social &amp; Ad Signal</h3>
            <ul>
              <li>Social engagement: {signalText(p.socialEngagement, v => v)}</li>
              <li>Ad activity: {signalText(p.adActivity, v => v)}</li>
              <li>First detected: {new Date(p.firstDetected).toLocaleDateString()} ({timeAgo(p.firstDetected)})</li>
              <li>Last detected: {new Date(p.lastDetected).toLocaleDateString()} ({timeAgo(p.lastDetected)})</li>
            </ul>
          </div>
        </div>

        <div className="merchBlock"><h3>AI Research Summary</h3>
          <ul>
            <li><b>Why it may be gaining momentum:</b> {p.aiSummary.momentumReason}</li>
            <li><b>Who would buy it:</b> {p.aiSummary.whoWouldBuy}</li>
            <li><b>Problem solved:</b> {p.aiSummary.problemSolved}</li>
            <li><b>Fort Crazypants fit:</b> {p.aiSummary.fortFitReason}</li>
            <li><b>Best season:</b> {p.aiSummary.bestSeason}</li>
            <li><b>Best platform:</b> {p.aiSummary.bestPlatform}</li>
            <li><b>Content angle:</b> {p.aiSummary.contentAngle}</li>
            <li><b>Suggested retail price:</b> {money(p.aiSummary.suggestedRetailPrice)}</li>
            <li><b>Risks:</b> {p.aiSummary.risks}</li>
          </ul>
          <div className="recommendationSummary" style={{ marginTop: 10 }}>Recommendation: {p.aiSummary.recommendation}</div>
        </div>

        <div className="merchBlock"><h3>Reasons to Test</h3>
          <ul>
            {p.familyFriendly && <li>Family-friendly appeal</li>}
            {p.problemSolving && <li>Clear problem-and-solution format</li>}
            {p.demonstrable && <li>Strong visual demonstration potential</li>}
            {p.giftable && <li>Giftable</li>}
            {(p.estimatedMargin ?? 0) >= 45 && <li>Healthy estimated profit margin</li>}
            {p.competitionLevel !== "high" && <li>Low-to-moderate competition</li>}
          </ul>
        </div>
        <div className="merchBlock"><h3>Reasons Not to Test</h3>
          <ul>
            {p.competitionLevel === "high" && <li>High competition</li>}
            {(p.shippingDays.value ?? 0) > 15 && <li>Slow shipping time</li>}
            {!p.demonstrable && <li>Hard to demonstrate visually</li>}
            {p.trendStage === "Saturated" && <li>Market appears saturated</li>}
            {p.trendStage === "Declining" && <li>Trend appears to be declining</li>}
            {p.confidence === "low" && <li>Low confidence — limited verified data</li>}
          </ul>
        </div>

        <div className="merchBlock"><h3>Supporting Evidence</h3>
          <ul>{p.evidence.map((e, i) => <li key={i}><b>{e.label}:</b> {e.detail} <span className="muted">({e.quality}, {e.source.replace(/_/g, " ")}, {timeAgo(e.timestamp)})</span></li>)}</ul>
        </div>

        {relatedBySource.length > 0 && <div className="merchBlock"><h3>Compare Suppliers / Sources</h3>
          <ul>{relatedBySource.map(r => <li key={r.id}>{r.source.replace(/_/g, " ")} — {signalText(r.supplierCost, v => money(v))} cost / {signalText(r.retailPrice, v => money(v))} retail, {signalText(r.shippingDays, v => `${v}d`)} shipping</li>)}</ul>
        </div>}
        </>}

        <BadgeRow product={p} />

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="secondary" onClick={onWatch}>{isWatched ? "★ Watching" : "☆ Add to Watchlist"}</button>
          <button className="primary" onClick={onAutoBuild} disabled={autoBuilding} title="Auto-generates title, description, pricing, category, SEO, and real AI images — lands in Product Studio for you to review and publish.">{autoBuilding ? "Auto-building…" : "Auto-build listing (AI)"}</button>
          <button className="secondary" onClick={onSendToStudio}>Send to Product Studio</button>
          <button className="secondary" onClick={() => onSetStatus("testing")}>Mark as Testing</button>
          <button className="secondary" onClick={() => onSetStatus("published")}>Mark as Published</button>
          <button className="secondary" onClick={() => onSetStatus("rejected")}>Mark as Rejected</button>
          {p.url && <a className="secondary" href={p.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", padding: "10px 14px", borderRadius: 10, textDecoration: "none" }}>Open Source ↗</a>}
          <button className="secondary" onClick={onExport}>Export CSV</button>
        </div>
      </div>
    </div>
  );
}
