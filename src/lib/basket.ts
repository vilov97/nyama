/**
 * Pure basket maths for the shop and checkout.
 *
 * Kept separate from the page so the money rules are testable without a DOM,
 * a Supabase client or a map. The page should never do arithmetic inline —
 * that is how totals drift from line items.
 *
 * Money is integer shillings throughout. Never floats: KSh 950.0000001 in a
 * basket is a rounding bug waiting to become a customer complaint.
 */

export type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price_ksh: number;
  unit: string;
  is_available?: boolean;
  category?: string;
  image_url?: string | null;
  sort_order?: number;
};

/** A menu row plus the quantity the customer is asking for. */
export type BasketLine = {
  menu_item_id: string;
  name: string;
  unit: string;
  unit_price_ksh: number;
  qty: number;
  note: string | null;
  image_url?: string | null;
};

export const MAX_QTY_PER_LINE = 99;

/**
 * Add one unit of a menu item, or increment an existing line.
 * Returns a new array; never mutates the input.
 */
export function addToBasket(lines: readonly BasketLine[], item: MenuItem): BasketLine[] {
  const existing = lines.findIndex((l) => l.menu_item_id === item.id);
  if (existing >= 0) {
    const current = lines[existing]!;
    if (current.qty >= MAX_QTY_PER_LINE) return [...lines];
    const next = [...lines];
    next[existing] = { ...current, qty: current.qty + 1 };
    return next;
  }
  return [
    ...lines,
    {
      menu_item_id: item.id,
      name: item.name,
      unit: item.unit,
      unit_price_ksh: item.price_ksh,
      qty: 1,
      note: null,
      image_url: item.image_url ?? null,
    },
  ];
}

/** Decrement a line; a line that reaches zero is removed entirely. */
export function removeOneFromBasket(lines: readonly BasketLine[], menuItemId: string): BasketLine[] {
  const idx = lines.findIndex((l) => l.menu_item_id === menuItemId);
  if (idx < 0) return [...lines];
  const current = lines[idx]!;
  if (current.qty <= 1) return lines.filter((l) => l.menu_item_id !== menuItemId);
  const next = [...lines];
  next[idx] = { ...current, qty: current.qty - 1 };
  return next;
}

/** Drop a line outright, whatever its quantity. */
export function removeLine(lines: readonly BasketLine[], menuItemId: string): BasketLine[] {
  return lines.filter((l) => l.menu_item_id !== menuItemId);
}

export function setLineQty(
  lines: readonly BasketLine[],
  menuItemId: string,
  qty: number
): BasketLine[] {
  if (!Number.isInteger(qty) || qty < 1) return removeLine(lines, menuItemId);
  const clamped = Math.min(qty, MAX_QTY_PER_LINE);
  return lines.map((l) => (l.menu_item_id === menuItemId ? { ...l, qty: clamped } : l));
}

/** Order total in whole shillings. */
export function basketTotal(lines: readonly BasketLine[]): number {
  return lines.reduce((sum, l) => sum + l.unit_price_ksh * l.qty, 0);
}

export function itemCount(lines: readonly BasketLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

export type BasketChange =
  | { kind: "removed"; name: string }
  | { kind: "repriced"; name: string; from: number; to: number };

/**
 * Bring a stored basket back in line with today's menu.
 *
 * A basket lives in the browser and can be days old. Items that were taken off
 * the menu are dropped, and prices are refreshed, so the total the customer
 * sees is the total the server will charge. Returns what changed so the page
 * can say so instead of changing the bill silently.
 */
export function reconcileBasket(
  lines: readonly BasketLine[],
  menu: readonly MenuItem[]
): { lines: BasketLine[]; changes: BasketChange[] } {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const next: BasketLine[] = [];
  const changes: BasketChange[] = [];
  for (const line of lines) {
    const item = byId.get(line.menu_item_id);
    if (!item || item.is_available === false) {
      changes.push({ kind: "removed", name: line.name });
      continue;
    }
    if (item.price_ksh !== line.unit_price_ksh) {
      changes.push({ kind: "repriced", name: item.name, from: line.unit_price_ksh, to: item.price_ksh });
    }
    next.push({
      ...line,
      name: item.name,
      unit: item.unit,
      unit_price_ksh: item.price_ksh,
      image_url: item.image_url ?? null,
    });
  }
  return { lines: next, changes };
}

/**
 * A drop pin is mandatory: dispatch cannot route an order it cannot place on
 * the map. Reject (0,0) because a default-zeroed pin lands in the Atlantic.
 */
export function isValidPin(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
