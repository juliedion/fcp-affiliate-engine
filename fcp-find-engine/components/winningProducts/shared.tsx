"use client";
import { BADGE_META, ProductOpportunity } from "@/lib/winningProducts/types";
import { money, pct, signalText } from "@/lib/winningProducts/format";

export function BadgeRow({ product }: { product: ProductOpportunity }) {
  if (!product.badges.length) return null;
  return <div className="pillRow">{product.badges.map(b => <span key={b} className="badge" title={BADGE_META[b].label}>{BADGE_META[b].emoji} {BADGE_META[b].label}</span>)}</div>;
}

export function MockTag({ isMock }: { isMock: boolean }) {
  if (!isMock) return null;
  return <span className="badge mockTag">MOCK DATA — dev only</span>;
}

export function ConfidenceTag({ confidence }: { confidence: ProductOpportunity["confidence"] }) {
  return <span className={`badge confidence-${confidence}`}>{confidence} confidence</span>;
}

export function statusLabel(status: ProductOpportunity["status"]): string {
  return { new: "New", watchlisted: "Watchlisted", rejected: "Rejected", testing: "Testing", published: "Published" }[status];
}

export function productSummaryLine(p: ProductOpportunity): string {
  return `${signalText(p.retailPrice, v => money(v))} · ${signalText(p.shippingDays, v => `${v}d ship`)} · ${pct(p.estimatedMargin)} margin`;
}
