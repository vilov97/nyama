import { useSyncExternalStore } from "react";
import {
  addToBasket,
  MAX_QTY_PER_LINE,
  removeLine,
  removeOneFromBasket,
  type BasketLine,
  type MenuItem,
} from "./basket";

/**
 * The cart, kept in localStorage so it survives a reload, a sign-in redirect
 * and a walk from the shop to checkout.
 *
 * Nothing here is trusted by the server: place_order() re-reads every price
 * from the database. The cart only decides what the customer sees.
 */
const KEY = "kwamaiko.cart.v1";

/** Parse whatever is in storage. Anything malformed is discarded, not repaired. */
export function parseStoredCart(raw: string | null): BasketLine[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const lines: BasketLine[] = [];
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.menu_item_id !== "string" || r.menu_item_id.length === 0) continue;
    if (typeof r.name !== "string" || typeof r.unit !== "string") continue;
    if (!Number.isInteger(r.unit_price_ksh) || (r.unit_price_ksh as number) < 0) continue;
    if (!Number.isInteger(r.qty) || (r.qty as number) < 1) continue;
    if (lines.some((l) => l.menu_item_id === r.menu_item_id)) continue;
    lines.push({
      menu_item_id: r.menu_item_id,
      name: r.name,
      unit: r.unit,
      unit_price_ksh: r.unit_price_ksh as number,
      qty: Math.min(r.qty as number, MAX_QTY_PER_LINE),
      note: typeof r.note === "string" ? r.note : null,
      image_url: typeof r.image_url === "string" ? r.image_url : null,
    });
  }
  return lines;
}

function read(): BasketLine[] {
  try {
    return parseStoredCart(window.localStorage.getItem(KEY));
  } catch {
    return []; // storage blocked (private mode): the cart still works in memory
  }
}

let lines: BasketLine[] = typeof window === "undefined" ? [] : read();
const listeners = new Set<() => void>();

function commit(next: BasketLine[]) {
  lines = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* in-memory only */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  // Another tab changed the cart: follow it.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    lines = parseStoredCart(e.newValue);
    listeners.forEach((l) => l());
  });
}

export const cart = {
  get: (): BasketLine[] => lines,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  add: (item: MenuItem) => commit(addToBasket(lines, item)),
  removeOne: (menuItemId: string) => commit(removeOneFromBasket(lines, menuItemId)),
  removeLine: (menuItemId: string) => commit(removeLine(lines, menuItemId)),
  replace: (next: BasketLine[]) => commit(next),
  clear: () => commit([]),
};

export function useCart(): BasketLine[] {
  return useSyncExternalStore(cart.subscribe, cart.get, cart.get);
}
