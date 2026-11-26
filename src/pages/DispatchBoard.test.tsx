// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

type Row = Record<string, unknown>;

const ok = (data: Row[]) => Promise.resolve({ data, error: null });

/**
 * Minimal stand-in for the supabase-js chainable query builder that *honours*
 * the equality filter, so role-scoped queries behave like the real thing.
 */
function makeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const base = tables[table] ?? [];
      const filters: Array<[string, unknown]> = [];
      const q: Row = {};
      const apply = () =>
        filters.reduce<Row[]>((acc, [col, val]) => acc.filter((r) => r[col] === val), base);
      q.select = () => q;
      q.in = () => q;
      q.order = () => q;
      q.eq = (col: string, val: unknown) => {
        filters.push([col, val]);
        return q;
      };
      q.then = (res: (v: unknown) => unknown) => ok(apply()).then(res);
      return q;
    },
  };
}

const tables: Record<string, Row[]> = {
  orders: [
    { id: "o1", customer_id: "c1", status: "assigned", total_ksh: 1800, is_paid: true,
      drop_note: "Gate 2", drop_lat: -1.3191, drop_lng: 36.7073, route_id: "r1",
      receiver: "Njoroge", receiver_phone: "+254712000001", created_at: "2026-11-26T10:00:00Z" },
    { id: "o2", customer_id: "c1", status: "ready", total_ksh: 950, is_paid: false,
      drop_note: "Call", drop_lat: -1.2664, drop_lng: 36.8031, route_id: "r2",
      receiver: "Wanjiru", receiver_phone: "+254712000002", created_at: "2026-11-26T11:00:00Z" },
  ],
  routes: [
    { id: "r1", name: "Karen / Langata", color: "#e11d48" },
    { id: "r2", name: "Westlands / Parklands", color: "#2563eb" },
  ],
  deliveries: [{ id: "dl1", order_id: "o1", rider_id: "d1", status: "assigned" }],
  profiles: [
    { id: "c1", full_name: "Jane Wanjiku", phone: "+254700000000", drop_address: "Karen, Hardy Shops" },
    { id: "d1", full_name: "Kimani Rider", role: "rider", is_active: true, max_stops: 5 },
  ],
};

vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => makeClient(tables),
}));

import DispatchBoard from "./DispatchBoard";

afterEach(cleanup);

const renderBoard = () => render(<MemoryRouter><DispatchBoard /></MemoryRouter>);

describe("DispatchBoard", () => {
  it("states that it is not live tracking", async () => {
    renderBoard();
    expect(screen.getAllByText(/No live tracking/i).length).toBeGreaterThan(0);
  });

  it("lists every direction in the legend after loading", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getAllByText("Karen / Langata").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Westlands / Parklands").length).toBeGreaterThan(0);
  });

  it("shows the rider run and its capacity", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getAllByText("Kimani Rider").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/1 of 5/).length).toBeGreaterThan(0);
  });

  it("lists the unassigned order, not the assigned one", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getAllByText(/Unassigned/).length).toBeGreaterThan(0));
    expect(screen.getAllByText("Jane Wanjiku").length).toBeGreaterThan(0);
  });
});
