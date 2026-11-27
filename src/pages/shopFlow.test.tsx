// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * The customer journey, end to end, against a stand-in for Supabase:
 * browse the shop without an account, fill a cart, check out.
 *
 * What these tests pin down is the contract with place_order(): the browser
 * sends ids and quantities, never prices, and it does not send an order the
 * server would refuse.
 */

type Row = Record<string, unknown>;

const BEEF = "9eacee18-cadb-4f75-9c66-6b58f76f12ac";
const RIBS = "d7988171-c780-4fad-b015-957f0e7b33a6";
const SOUP = "00000000-0000-4000-8000-000000000003";

const menu: Row[] = [
  { id: BEEF, name: "Beef Premium", description: "Lean", price_ksh: 720, unit: "kg", is_available: true, category: "beef", image_url: "/menu/beef-premium.jpg", sort_order: 1 },
  { id: RIBS, name: "Goat Ribs", description: null, price_ksh: 900, unit: "kg", is_available: true, category: "goat", image_url: "/menu/goat-ribs.jpg", sort_order: 2 },
  { id: SOUP, name: "Goat Soup Pack", description: null, price_ksh: 400, unit: "kg", is_available: false, category: "goat", image_url: null, sort_order: 3 },
];

const slot = (slot_date: string, window_code: string, starts: string, ends: string, available = true) => ({
  slot_date,
  window_code,
  shift_code: "morning",
  starts_at: `${slot_date}T${starts}:00+03:00`,
  ends_at: `${slot_date}T${ends}:00+03:00`,
  left_count: available ? 12 : 0,
  available,
  reason: available ? null : "too_late",
});

const options = {
  delivery_fee_ksh: 200,
  asap_minutes: 90,
  pickup_minutes: 45,
  open_now: true,
  today: "2026-11-27",
  asap: { delivery: true, pickup: true },
  slots: {
    delivery: [slot("2026-11-27", "m1", "08:00", "10:00", false), slot("2026-11-28", "m1", "08:00", "10:00")],
    pickup: [slot("2026-11-27", "m1", "08:00", "10:00", false), slot("2026-11-28", "m1", "08:00", "10:00")],
  },
};

type Rpc = (name: string, args?: unknown) => Promise<{ data: unknown; error: Error | null }>;

const db = {
  tables: {} as Record<string, Row[]>,
  rpc: vi.fn<Rpc>(),
};

function makeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rows = () =>
        filters.reduce<Row[]>((acc, [c, v]) => acc.filter((r) => r[c] === v), db.tables[table] ?? []);
      const q: Row = {};
      q.select = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.eq = (c: string, v: unknown) => {
        filters.push([c, v]);
        return q;
      };
      q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      q.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res);
      return q;
    },
    rpc: (name: string, args?: unknown) => db.rpc(name, args),
  };
}

const auth = { user: null as null | { id: string; email: string }, role: null as null | string };

vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => makeClient(),
}));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    ...auth,
    configured: true,
    loading: false,
    refreshProfile: async () => {},
    signOutEverywhere: async () => {},
  }),
}));

import ShopPage from "./ShopPage";
import CheckoutPage from "./CheckoutPage";
import { cart } from "../lib/cart";
import type { MenuItem } from "../lib/basket";

const item = (id: string) => menu.find((m) => m.id === id) as unknown as MenuItem;

/** Stands in for /app so a successful checkout has somewhere visible to land. */
function Landed() {
  const state = useLocation().state as { placed?: { order_id: string; total_ksh: number } } | null;
  return <p>landed {state?.placed?.order_id} {state?.placed?.total_ksh}</p>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/app" element={<Landed />} />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>
    </MemoryRouter>
  );

const placeButton = () => screen.getAllByRole("button", { name: /^Place order/ })[0];
const placeCalls = () => db.rpc.mock.calls.filter(([name]) => name === "place_order");

beforeEach(() => {
  window.localStorage.clear();
  cart.clear();
  auth.user = null;
  auth.role = null;
  db.tables = { menu_items: menu, profiles: [], orders: [] };
  db.rpc = vi.fn<Rpc>((name) => {
    if (name === "checkout_options") return Promise.resolve({ data: options, error: null });
    if (name === "place_order")
      return Promise.resolve({
        data: { order_id: "abc123def", lines: 2, subtotal_ksh: 2340, delivery_fee_ksh: 200, total_ksh: 2540, due_from: "2026-11-27T10:00:00Z", due_by: "2026-11-27T11:30:00Z" },
        error: null,
      });
    return Promise.resolve({ data: null, error: null });
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe("shop", () => {
  it("lets a visitor with no account browse and fill a cart", async () => {
    renderAt("/shop");
    await waitFor(() => expect(screen.getByText("Beef Premium")).toBeTruthy());

    const card = screen.getByText("Beef Premium").closest("li") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Add to cart" }));
    fireEvent.click(within(card).getByRole("button", { name: "Add one Beef Premium" }));

    expect(cart.get()).toMatchObject([{ menu_item_id: BEEF, qty: 2, unit_price_ksh: 720 }]);
    expect(screen.getByText(/2 items · view cart/)).toBeTruthy();
    const bar = screen.getByText(/2 items · view cart/).closest("button") as HTMLElement;
    expect(within(bar).getByText("KSh 1,440")).toBeTruthy();
  });

  it("keeps the closed cart drawer out of reach of the keyboard", async () => {
    renderAt("/shop");
    await waitFor(() => expect(screen.getByText("Beef Premium")).toBeTruthy());
    const drawer = document.querySelector('[aria-label="Your cart"]')?.parentElement as HTMLElement;
    expect(drawer.hasAttribute("inert")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Cart/ }));
    expect(drawer.hasAttribute("inert")).toBe(false);
  });

  it("shows a sold-out cut but will not let it be added", async () => {
    renderAt("/shop");
    await waitFor(() => expect(screen.getByText("Goat Soup Pack")).toBeTruthy());
    const card = screen.getByText("Goat Soup Pack").closest("li") as HTMLElement;
    expect(within(card).getByText("Sold out today")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Add to cart" })).toBeNull();
  });

  it("filters by category", async () => {
    renderAt("/shop");
    await waitFor(() => expect(screen.getByText("Beef Premium")).toBeTruthy());
    const rail = screen.getByRole("navigation", { name: "Categories" });
    fireEvent.click(within(rail).getByRole("button", { name: /^Goat/ }));
    expect(screen.queryByText("Beef Premium")).toBeNull();
    expect(screen.getByText("Goat Ribs")).toBeTruthy();
  });

  it("keeps the cart across a reload", async () => {
    cart.add(item(RIBS));
    const first = renderAt("/shop");
    first.unmount();
    renderAt("/shop");
    await waitFor(() => expect(screen.getByText(/1 item · view cart/)).toBeTruthy());
  });
});

describe("checkout", () => {
  beforeEach(() => {
    auth.user = { id: "u1", email: "a@kwamaiko.test" };
    auth.role = "customer";
    cart.add(item(BEEF));
    cart.add(item(BEEF));
    cart.add(item(RIBS));
  });

  const returning = () => {
    db.tables.orders = [
      { fulfilment: "delivery", receiver: "Jane Wanjiku", receiver_phone: "+254712345678", drop_address: "Ngong Rd 4B", drop_note: "Blue gate", drop_lat: -1.3, drop_lng: 36.78 },
    ];
  };

  it("shows subtotal, the delivery fee and the total before anything is placed", async () => {
    returning();
    renderAt("/checkout");
    await waitFor(() => expect(screen.getByText("KSh 2,340")).toBeTruthy());
    await waitFor(() => expect(placeButton().textContent).toContain("KSh 2,540"));
  });

  it("places a returning customer's order in one tap, and never sends a price", async () => {
    returning();
    renderAt("/checkout");
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Jane Wanjiku"));
    await waitFor(() => expect(placeButton().hasAttribute("disabled")).toBe(false));

    fireEvent.click(placeButton());
    await waitFor(() => expect(screen.getByText(/landed abc123def 2540/)).toBeTruthy());

    expect(placeCalls()).toHaveLength(1);
    const payload = (placeCalls()[0][1] as { p: Record<string, unknown> }).p;
    expect(payload).toMatchObject({
      fulfilment: "delivery",
      when: "asap",
      receiver: "Jane Wanjiku",
      receiver_phone: "+254712345678",
      drop_address: "Ngong Rd 4B",
      drop_lat: -1.3,
      drop_lng: 36.78,
      substitution: "call_me",
    });
    expect(payload.items).toEqual([
      { menu_item_id: BEEF, qty: 2, note: null },
      { menu_item_id: RIBS, qty: 1, note: null },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/price|total|fee/i);
    expect(cart.get()).toEqual([]);
  });

  it("stops a first-time customer with no drop pin, says why, and sends nothing", async () => {
    renderAt("/checkout");
    await waitFor(() => expect(placeButton().hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "0712 345 678" } });
    fireEvent.change(screen.getByLabelText("Street, building, house"), { target: { value: "Ngong Rd 4B" } });

    fireEvent.click(placeButton());
    await waitFor(() => expect(screen.getAllByText(/pin/i).length).toBeGreaterThan(0));
    expect(document.querySelector("#co-pin .text-red-600")).not.toBeNull();
    expect(placeCalls()).toHaveLength(0);
    expect(cart.get()).toHaveLength(2);
  });

  it("makes pickup free and asks for no address or pin", async () => {
    renderAt("/checkout");
    await waitFor(() => expect(placeButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("radio", { name: /Pickup/ }));
    await waitFor(() => expect(placeButton().textContent).toContain("KSh 2,340"));
    expect(screen.queryByLabelText("Street, building, house")).toBeNull();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "0712345678" } });
    fireEvent.click(placeButton());
    await waitFor(() => expect(placeCalls()).toHaveLength(1));

    const payload = (placeCalls()[0][1] as { p: Record<string, unknown> }).p;
    expect(payload).toMatchObject({ fulfilment: "pickup", receiver_phone: "+254712345678" });
    expect(payload.drop_lat ?? null).toBeNull();
  });

  it("sends the chosen day and time window for an order booked ahead", async () => {
    returning();
    renderAt("/checkout");
    await waitFor(() => expect(placeButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Timing" })).getAllByRole("radio")[1]);
    fireEvent.click(placeButton());
    await waitFor(() => expect(placeCalls()).toHaveLength(1));
    const payload = (placeCalls()[0][1] as { p: Record<string, unknown> }).p;
    // Today's only window has passed, so the first open one is tomorrow's.
    expect(payload).toMatchObject({ when: "scheduled", slot_date: "2026-11-28", window_code: "m1" });
  });

  it("tells the customer when a price changed or a cut sold out since they added it", async () => {
    returning();
    db.tables.menu_items = [
      { ...menu[0], price_ksh: 800 },
      { ...menu[1], is_available: false },
    ];
    renderAt("/checkout");
    await waitFor(() => expect(cart.get()).toMatchObject([{ menu_item_id: BEEF, unit_price_ksh: 800 }]));
    expect(screen.getAllByText(/Goat Ribs/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Beef Premium/).length).toBeGreaterThan(0);
    await waitFor(() => expect(placeButton().textContent).toContain("KSh 1,800"));
  });

  it("shows the server's reason and keeps the cart when the order is refused", async () => {
    returning();
    db.rpc = vi.fn<Rpc>((name) =>
      name === "checkout_options"
        ? Promise.resolve({ data: options, error: null })
        : Promise.resolve({ data: null, error: new Error("That delivery time has just filled up. Please pick another.") })
    );
    renderAt("/checkout");
    await waitFor(() => expect(placeButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(placeButton());
    await waitFor(() => expect(screen.getAllByRole("alert")[0].textContent).toMatch(/just filled up/));
    expect(cart.get()).toHaveLength(2);
    expect(screen.queryByText(/landed/)).toBeNull();
  });

  it("sends an empty cart back to the shop instead of showing a form", async () => {
    cart.clear();
    renderAt("/checkout");
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /^Place order/ })).toBeNull();
  });
});
