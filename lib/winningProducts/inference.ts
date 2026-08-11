import { FortCategory } from "./types";

// Category-level heuristics reused across adapters so real listings (Amazon, Google
// Shopping, Trends, CJ) don't all show "Not enough verified data." for fields no
// source hands us directly — these are clearly-derived (not observed) but reasonable.

export const CATEGORY_AUDIENCE: Record<FortCategory, string> = {
  "Home Organization": "busy families and small-space organizers", "Kitchen Helpers": "home cooks and busy families",
  "Cleaning": "busy households", "Family Life": "parents managing a busy household", "Kids": "parents of young children",
  "Pets": "pet owners", "Outdoor": "outdoor and gardening enthusiasts", "Travel": "frequent travelers",
  "Car Accessories": "commuters and road-trippers", "Gifts": "gift shoppers", "Seasonal": "seasonal shoppers",
  "Everyday Problem Solvers": "busy households"
};

export const CATEGORY_PROBLEM: Record<FortCategory, string> = {
  "Home Organization": "cluttered spaces with no convenient home for everyday items",
  "Kitchen Helpers": "slow, messy, or frustrating kitchen tasks",
  "Cleaning": "time-consuming or ineffective cleaning routines",
  "Family Life": "keeping a household's schedules and shared tasks organized",
  "Kids": "keeping kids occupied, safe, or engaged",
  "Pets": "everyday hassles of pet care and cleanup",
  "Outdoor": "inefficient or frustrating outdoor upkeep",
  "Travel": "packing, organizing, or staying comfortable while traveling",
  "Car Accessories": "keeping a car organized, clean, or road-trip ready",
  "Gifts": "finding a gift that feels thoughtful rather than generic",
  "Seasonal": "seasonal prep or decorating that takes too much time or effort",
  "Everyday Problem Solvers": "a small everyday annoyance with no obvious fix"
};

const GIFT_KEYWORDS = ["gift", "present", "birthday", "anniversary", "personalized", "engraved"];
const PROBLEM_KEYWORDS = ["organizer", "holder", "rack", "storage", "cleaner", "opener", "chopper", "helper", "stand", "mount"];
const DEMO_KEYWORDS = ["chopper", "cleaner", "vacuum", "opener", "sprayer", "gadget", "tool", "kit", "mop"];

export function inferTraits(title: string, category: FortCategory | "Uncategorized") {
  const t = title.toLowerCase();
  // Every Fort Crazypants category is household/lifestyle-oriented, so this defaults true —
  // there's no category in the catalog that would reasonably be flagged not-family-friendly.
  const familyFriendly = true;
  const giftable = category === "Gifts" || GIFT_KEYWORDS.some(k => t.includes(k));
  const problemSolving = category === "Everyday Problem Solvers" || category === "Kitchen Helpers" || category === "Home Organization" || category === "Cleaning" || PROBLEM_KEYWORDS.some(k => t.includes(k));
  const demonstrable = DEMO_KEYWORDS.some(k => t.includes(k)) || problemSolving;
  const demoPotential: "low" | "medium" | "high" = demonstrable ? "high" : "medium";
  return { familyFriendly, giftable, problemSolving, demonstrable, demoPotential };
}

export function inferAudience(category: FortCategory | "Uncategorized"): string {
  return category === "Uncategorized" ? "Not enough verified data." : CATEGORY_AUDIENCE[category];
}

export function inferProblem(category: FortCategory | "Uncategorized"): string {
  return category === "Uncategorized" ? "Not enough verified data." : CATEGORY_PROBLEM[category];
}

const CATEGORY_TEXT_KEYWORDS: { category: FortCategory; keywords: string[] }[] = [
  { category: "Home Organization", keywords: ["organiz", "storage", "closet", "shelf", "declutter", "pantry", "bin"] },
  { category: "Kitchen Helpers", keywords: ["kitchen", "cook", "recipe", "utensil", "gadget", "pan", "appliance", "chopper", "blender"] },
  { category: "Cleaning", keywords: ["clean", "mop", "vacuum", "laundry", "stain", "tidy"] },
  { category: "Family Life", keywords: ["family", "budget", "meal plan", "chore", "schedule", "routine"] },
  { category: "Kids", keywords: ["kid", "toddler", "toy", "child", "baby"] },
  { category: "Pets", keywords: ["pet", "dog", "cat", "leash", "litter"] },
  { category: "Outdoor", keywords: ["outdoor", "garden", "patio", "yard", "porch", "camping", "hammock"] },
  { category: "Travel", keywords: ["travel", "luggage", "packing", "suitcase", "tsa"] },
  { category: "Car Accessories", keywords: ["car ", "vehicle", "trunk", "dashboard", "seat organizer"] },
  { category: "Gifts", keywords: ["gift", "present", "personalized", "engraved"] },
  { category: "Seasonal", keywords: ["christmas", "holiday", "fall", "summer", "winter", "spring", "halloween"] }
];

// Free-text search queries don't come with a pre-assigned category — this maps a search
// term (or scraped title) to the closest FortCategory using the same keyword heuristics
// used elsewhere, falling back to "Everyday Problem Solvers" when nothing matches.
export function inferCategoryFromKeyword(text: string): FortCategory {
  const lower = text.toLowerCase();
  const match = CATEGORY_TEXT_KEYWORDS.find(c => c.keywords.some(k => lower.includes(k)));
  return match?.category ?? "Everyday Problem Solvers";
}
