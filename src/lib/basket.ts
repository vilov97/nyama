/**
 * Pure basket maths for order creation.
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
};

/** A menu row plus the quantity the customer is asking for. */
export type BasketLine = {
  menu_item_id: string;
  name: string;
  unit: string;
  unit_price_ksh: number;
  qty: number;
  note: string | null;
};

/** Shape sent to `order_items`, matching the table's columns exactly. */
export type OrderItemInsert = {
  menu_item_id: string;
  name_snapshot: string;
  unit: string;
  qty: number;
  unit_price_ksh: number;
  note: string | null;
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

/** Rows to insert into `order_items`. */
export function toOrderItems(lines: readonly BasketLine[]): OrderItemInsert[] {
  return lines.map((l) => ({
    menu_item_id: l.menu_item_id,
    name_snapshot: l.name,
    unit: l.unit,
    qty: l.qty,
    unit_price_ksh: l.unit_price_ksh,
    note: l.note,
  }));
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

/** Why an order cannot be placed yet, or null if it can. */
export function orderBlocker(input: {
  lines: readonly BasketLine[];
  lat: number | null;
  lng: number | null;
  receiver: string;
}): string | null {
  if (input.lines.length === 0) return "Add at least one item.";
  if (!isValidPin(input.lat, input.lng)) return "Drop your pin on the map.";
  if (input.receiver.trim().length === 0) return "Who is receiving this order?";
  return null;
}
