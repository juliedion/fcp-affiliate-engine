"use client";
import { ProductOpportunity } from "@/lib/winningProducts/types";
import { money, pct, signalText } from "@/lib/winningProducts/format";
import { BadgeRow, ConfidenceTag, MockTag, statusLabel } from "./shared";

export default function ProductCard({ product, onOpen, onWatch, isWatched }: { product: ProductOpportunity; onOpen: () => void; onWatch: () => void; isWatched: boolean }) {
  const p = product;
  return (
    <div className="wpfCard" onClick={onOpen}>
      <div className="wpfCardImage">{p.image ? <img src={p.image} alt="" /> : <div className="wpfCardImagePlaceholder">No image</div>}</div>
      <div className="wpfCardBody">
        <div className="wpfCardTitleRow"><b>{p.title}</b><span className="badge">{statusLabel(p.status)}</span></div>
        <div className="muted" style={{ fontSize: 12 }}>{p.source.replace(/_/g, " ")} · {p.category}</div>
        <div className="wpfCardStats">
          <div><span className="muted">Cost</span><b>{signalText(p.supplierCost, v => money(v))}</b></div>
          <div><span className="muted">Retail</span><b>{signalText(p.retailPrice, v => money(v))}</b></div>
          <div><span className="muted">Profit</span><b>{money(p.estimatedProfit)}</b></div>
          <div><span className="muted">Margin</span><b>{pct(p.estimatedMargin)}</b></div>
        </div>
        <div className="wpfCardScores">
          <span className="badge scoreBadge">Winning {p.score.total}</span>
          <span className="badge scoreBadge">Fort Fit {p.fortFit.total}</span>
          <span className="badge">{p.trendStage}</span>
          <span className="badge" style={{ textTransform: "capitalize" }}>{p.competitionLevel} competition</span>
        </div>
        <BadgeRow product={p} />
        <div className="wpfCardFoot">
          <ConfidenceTag confidence={p.confidence} />
          <MockTag isMock={p.isMock} />
        </div>
        <div className="actions" onClick={e => e.stopPropagation()}>
          <button className="secondary" onClick={onWatch}>{isWatched ? "★ Watching" : "☆ Watchlist"}</button>
          <button className="secondary" onClick={onOpen}>Analyze</button>
        </div>
      </div>
    </div>
  );
}
