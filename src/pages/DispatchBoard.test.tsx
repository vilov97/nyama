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
      receiver: "Njoroge", receiver_phone: "+254712000001", created_at: "2026-11-26T10:00:00Z",
      fulfilment: "delivery", cook_status: "ready", delivery_status: "assigned", drop_address: "Karen Rd 1",
      due_from: "2026-11-26T10:00:00Z", due_by: "2026-11-26T11:30:00Z" },
    { id: "o2", customer_id: "c1", status: "ready", total_ksh: 950, is_paid: false,
      drop_note: "Call", drop_lat: -1.2664, drop_lng: 36.8031, route_id: "r2",
      receiver: "Wanjiru", receiver_phone: "+254712000002", created_at: "2026-11-26T11:00:00Z",
      fulfilment: "delivery", cook_status: "preparing", delivery_status: "unassigned", drop_address: "Westlands Rd 2",
      due_from: "2026-11-26T11:00:00Z", due_by: "2026-11-26T12:30:00Z" },
    // A counter pickup: must never reach the dispatch board.
    { id: "o3", customer_id: "c1", status: "ready", total_ksh: 700, is_paid: false,
      drop_note: null, drop_lat: null, drop_lng: null, route_id: null,
      receiver: "Pickup Otieno", receiver_phone: "+254712000003", created_at: "2026-11-26T11:05:00Z",
      fulfilment: "pickup", cook_status: "ready", delivery_status: "unassigned", drop_address: null,
      due_from: "2026-11-26T11:05:00Z", due_by: "2026-11-26T11:50:00Z" },
    // Booked for a day far in the future: counted, but kept off today's board.
    { id: "o4", customer_id: "c1", status: "pending", total_ksh: 900, is_paid: false,
      drop_note: null, drop_lat: -1.29, drop_lng: 36.8, route_id: "r2",
      receiver: "Future Achieng", receiver_phone: "+254712000004", created_at: "2026-11-26T11:06:00Z",
      fulfilment: "delivery", cook_status: "pending", delivery_status: "unassigned", drop_address: "Later Rd 9",
      due_from: "2999-01-01T07:00:00Z", due_by: "2999-01-01T09:00:00Z" },
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
    await waitFor(() => expect(screen.getAllByText("Wanjiru").length).toBeGreaterThan(0));
    expect(screen.getByText(/Unassigned · 1/)).toBeTruthy();
    expect(screen.queryByText("Njoroge")).toBeNull();
  });

  it("shows the kitchen's progress and the deadline on an unassigned order", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getAllByText("Wanjiru").length).toBeGreaterThan(0));
    expect(screen.getByText("Cooking")).toBeTruthy();
    expect(screen.getByText(/^Late by/)).toBeTruthy();
  });

  it("never lists a counter pickup: it needs no rider", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getAllByText("Wanjiru").length).toBeGreaterThan(0));
    expect(screen.queryByText("Pickup Otieno")).toBeNull();
  });

  it("keeps orders booked for a later day off today's board, but counts them", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getAllByText("Wanjiru").length).toBeGreaterThan(0));
    expect(screen.queryByText("Future Achieng")).toBeNull();
    expect(screen.getByText(/1 more booked for later days/)).toBeTruthy();
  });
});
