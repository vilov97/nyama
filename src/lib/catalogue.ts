import type { MenuItem } from "./basket";

/** Shop categories in the order the butchery wants them on the rail. */
const CATEGORY_ORDER = ["goat", "beef", "chicken", "platters"];

const CATEGORY_LABEL: Record<string, string> = {
  goat: "Goat",
  beef: "Beef",
  chicken: "Chicken",
  platters: "Platters",
  other: "Other",
};

export const ALL = "all";

export function categoryLabel(key: string): string {
  return CATEGORY_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function rank(key: string): number {
  const i = CATEGORY_ORDER.indexOf(key);
  if (i >= 0) return i;
  return key === "other" ? Number.MAX_SAFE_INTEGER : CATEGORY_ORDER.length;
}

export type Category = { key: string; label: string; count: number };

/** Categories that actually have items, known ones first, "Other" last. */
export function categories(menu: readonly MenuItem[]): Category[] {
  const counts = new Map<string, number>();
  for (const item of menu) {
    const key = item.category ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: categoryLabel(key), count }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
}

/**
 * Items to show for a category. Sold-out items stay visible but sink to the
 * bottom, so a customer can see the cut exists without it getting in the way.
 */
export function visibleItems(menu: readonly MenuItem[], category: string): MenuItem[] {
  return menu
    .filter((m) => category === ALL || (m.category ?? "other") === category)
    .sort(
      (a, b) =>
        Number(a.is_available === false) - Number(b.is_available === false) ||
        rank(a.category ?? "other") - rank(b.category ?? "other") ||
        (a.sort_order ?? 100) - (b.sort_order ?? 100) ||
        a.name.localeCompare(b.name)
    );
}
