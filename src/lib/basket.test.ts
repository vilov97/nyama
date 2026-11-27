import { describe, expect, it } from "vitest";
import {
  addToBasket,
  basketTotal,
  isValidPin,
  itemCount,
  MAX_QTY_PER_LINE,
  reconcileBasket,
  removeLine,
  removeOneFromBasket,
  setLineQty,
  type BasketLine,
  type MenuItem,
} from "./basket";

const beef: MenuItem = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Beef Premium",
  description: "Topside",
  price_ksh: 950,
  unit: "kg",
};
const goat: MenuItem = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Goat Choma Cut",
  description: null,
  price_ksh: 700,
  unit: "kg",
};

describe("basket arithmetic", () => {
  it("adds a new line at qty 1", () => {
    const lines = addToBasket([], beef);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe(1);
    expect(lines[0]!.unit_price_ksh).toBe(950);
  });

  it("increments the same item rather than duplicating the line", () => {
    const lines = addToBasket(addToBasket([], beef), beef);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe(2);
  });

  it("keeps distinct menu items on separate lines", () => {
    const lines = addToBasket(addToBasket([], beef), goat);
    expect(lines).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const original: BasketLine[] = [];
    const next = addToBasket(original, beef);
    expect(original).toHaveLength(0);
    expect(next).toHaveLength(1);
  });

  it("caps a single line at the maximum quantity", () => {
    let lines: BasketLine[] = [];
    for (let i = 0; i < MAX_QTY_PER_LINE + 5; i++) lines = addToBasket(lines, beef);
    expect(lines[0]!.qty).toBe(MAX_QTY_PER_LINE);
  });

  it("removes the line when the last unit is taken off", () => {
    const lines = addToBasket([], beef);
    expect(removeOneFromBasket(lines, beef.id)).toHaveLength(0);
  });

  it("decrements without removing while quantity remains", () => {
    const lines = addToBasket(addToBasket([], beef), beef);
    const after = removeOneFromBasket(lines, beef.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.qty).toBe(1);
  });

  it("ignores removal of an item that is not in the basket", () => {
    const lines = addToBasket([], beef);
    expect(removeOneFromBasket(lines, "nope")).toHaveLength(1);
    expect(removeLine(lines, "nope")).toHaveLength(1);
  });

  it("removes a whole line regardless of quantity", () => {
    let lines: BasketLine[] = [];
    for (let i = 0; i < 4; i++) lines = addToBasket(lines, beef);
    expect(removeLine(lines, beef.id)).toHaveLength(0);
  });

  it("clamps a typed quantity and drops non-positive values", () => {
    const lines = addToBasket([], beef);
    expect(setLineQty(lines, beef.id, 0)[0]).toBeUndefined();
    expect(setLineQty(lines, beef.id, 500)[0]!.qty).toBe(MAX_QTY_PER_LINE);
    expect(setLineQty(lines, beef.id, 3)[0]!.qty).toBe(3);
  });

  it("totals in whole shillings", () => {
    let lines = addToBasket([], beef); // 950
    lines = addToBasket(lines, beef); // +950
    lines = addToBasket(lines, goat); // +700
    expect(basketTotal(lines)).toBe(2600);
    expect(Number.isInteger(basketTotal(lines))).toBe(true);
  });

  it("counts units, not lines", () => {
    let lines = addToBasket([], beef);
    lines = addToBasket(lines, beef);
    lines = addToBasket(lines, goat);
    expect(lines).toHaveLength(2);
    expect(itemCount(lines)).toBe(3);
  });

  it("an empty basket is worth nothing", () => {
    expect(basketTotal([])).toBe(0);
    expect(itemCount([])).toBe(0);
  });

  it("snapshots the name and price so later menu edits cannot rewrite the line", () => {
    const lines = addToBasket([], beef);
    expect(lines[0]).toMatchObject({ name: "Beef Premium", unit_price_ksh: 950, unit: "kg" });
  });
});

describe("reconcileBasket", () => {
  const stored: BasketLine[] = addToBasket(addToBasket(addToBasket([], beef), beef), goat);

  it("leaves an up-to-date basket alone", () => {
    const { lines, changes } = reconcileBasket(stored, [beef, goat]);
    expect(changes).toEqual([]);
    expect(basketTotal(lines)).toBe(2 * 950 + 700);
  });

  it("refreshes a changed price and reports it", () => {
    const { lines, changes } = reconcileBasket(stored, [{ ...beef, price_ksh: 1000 }, goat]);
    expect(changes).toEqual([{ kind: "repriced", name: "Beef Premium", from: 950, to: 1000 }]);
    expect(basketTotal(lines)).toBe(2 * 1000 + 700);
  });

  it("drops items that left the menu or are sold out today", () => {
    const gone = reconcileBasket(stored, [goat]);
    expect(gone.lines.map((l) => l.name)).toEqual(["Goat Choma Cut"]);
    expect(gone.changes).toEqual([{ kind: "removed", name: "Beef Premium" }]);

    const soldOut = reconcileBasket(stored, [beef, { ...goat, is_available: false }]);
    expect(soldOut.lines.map((l) => l.name)).toEqual(["Beef Premium"]);
  });

  it("keeps the customer's quantities", () => {
    const { lines } = reconcileBasket(stored, [beef, goat]);
    expect(lines.map((l) => l.qty)).toEqual([2, 1]);
  });
});

describe("drop pin validation", () => {
  it("accepts a real Nairobi pin", () => {
    expect(isValidPin(-1.2921, 36.8219)).toBe(true);
  });

  it("rejects a missing pin", () => {
    expect(isValidPin(null, 36.8)).toBe(false);
    expect(isValidPin(-1.29, null)).toBe(false);
  });

  it("rejects the zero pin, which would land in the Atlantic", () => {
    expect(isValidPin(0, 0)).toBe(false);
  });

  it("rejects out-of-range and non-finite coordinates", () => {
    expect(isValidPin(91, 36)).toBe(false);
    expect(isValidPin(-1, 181)).toBe(false);
    expect(isValidPin(NaN, 36)).toBe(false);
  });
});
