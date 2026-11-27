import { describe, expect, it } from "vitest";
import type { MenuItem } from "./basket";
import { ALL, categories, categoryLabel, visibleItems } from "./catalogue";

const item = (name: string, category: string | undefined, over: Partial<MenuItem> = {}): MenuItem => ({
  id: name,
  name,
  description: null,
  price_ksh: 500,
  unit: "kg",
  category,
  ...over,
});

const menu: MenuItem[] = [
  item("Chicken", "chicken"),
  item("Mystery", undefined),
  item("Beef Strips", "beef", { sort_order: 20 }),
  item("Beef Premium", "beef", { sort_order: 10 }),
  item("Goat Ribs", "goat", { sort_order: 20, is_available: false }),
  item("Goat Choma Cut", "goat", { sort_order: 10 }),
  item("Lamb Chops", "lamb"),
];

describe("categories", () => {
  it("lists only categories that have items, with counts", () => {
    expect(categories(menu).map((c) => [c.key, c.count])).toEqual([
      ["goat", 2],
      ["beef", 2],
      ["chicken", 1],
      ["lamb", 1],
      ["other", 1],
    ]);
  });

  it("labels a category nobody planned for", () => {
    expect(categoryLabel("lamb")).toBe("Lamb");
    expect(categoryLabel("goat")).toBe("Goat");
  });
});

describe("visibleItems", () => {
  it("filters to one category in the butchery's order", () => {
    expect(visibleItems(menu, "beef").map((m) => m.name)).toEqual(["Beef Premium", "Beef Strips"]);
  });

  it("shows everything under All, sold-out items last", () => {
    const names = visibleItems(menu, ALL).map((m) => m.name);
    expect(names).toHaveLength(menu.length);
    expect(names[0]).toBe("Goat Choma Cut");
    expect(names.at(-1)).toBe("Goat Ribs");
  });

  it("keeps a sold-out item visible inside its own category", () => {
    expect(visibleItems(menu, "goat").map((m) => m.name)).toEqual(["Goat Choma Cut", "Goat Ribs"]);
  });

  it("does not mutate the menu", () => {
    const before = menu.map((m) => m.name);
    visibleItems(menu, ALL);
    expect(menu.map((m) => m.name)).toEqual(before);
  });
});
