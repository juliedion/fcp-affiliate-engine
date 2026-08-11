import { DataQuality } from "./types";

export const money = (n: number | null): string => n === null ? "Not enough verified data." : `$${n.toFixed(2)}`;
export const pct = (n: number | null): string => n === null ? "Not enough verified data." : `${n}%`;
export const days = (n: number | null): string => n === null ? "Not enough verified data." : `${n} day${n === 1 ? "" : "s"}`;

export const qualityLabel: Record<DataQuality, string> = {
  observed: "Observed",
  calculated: "Calculated",
  ai_estimated: "AI-estimated",
  mock: "Mock (dev only)",
  unavailable: "Not enough verified data."
};

export function signalText<T>(sig: { value: T | null; quality: DataQuality }, fmt: (v: T) => string): string {
  if (sig.value === null || sig.quality === "unavailable") return "Not enough verified data.";
  return fmt(sig.value);
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
