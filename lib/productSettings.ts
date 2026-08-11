import { DEFAULT_PRODUCT_SETTINGS, ProductSettings } from "./types";

const KEY = "fort-product-settings";

export function getProductSettings(): ProductSettings {
  if (typeof window === "undefined") return DEFAULT_PRODUCT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PRODUCT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_PRODUCT_SETTINGS;
  } catch {
    return DEFAULT_PRODUCT_SETTINGS;
  }
}

export function saveProductSettings(settings: ProductSettings) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(settings));
}
