import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as LeafletNs from "leaflet";
import { getSupabase } from "../lib/supabase";
import {
  DEPOT,
  capacityLabel,
  capacityState,
  formatKm,
  pinColor,
  routeDistanceKm,
  sequenceStops,
} from "../lib/dispatch";
import { depotIcon, pinIcon, useLeafletMap, withAlpha } from "../lib/leaflet";
import { dueLabel, isDueToday, type DueTone } from "../lib/checkout";

type Route = { id: string; name: string; color: string };

type Staff = {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  max_stops: number;
};

type Assignment = {
  id: string;
  order_id: string;
  rider_id: string | null;
  status: string;
};

type DeliveryOrder = {
  id: string;
  customer_id: string;
  status: string;
  total_ksh: number;
  is_paid: boolean;
  drop_note: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  route_id: string | null;
  receiver: string | null;
  receiver_phone: string | null;
  cook_status: "pending" | "accepted" | "preparing" | "ready" | "done";
  delivery_status: string;
  created_at: string;
  drop_address: string | null;
  due_from: string;
  due_by: string;
};

const DUE_CLS: Record<DueTone, string> = {
  later: "text-neutral-500",
  ok: "text-neutral-600",
  soon: "text-amber-700",
  late: "text-red-600",
};

const COOK_LABEL: Record<string, string> = {
  pending: "Not started",
  accepted: "Accepted",
  preparing: "Cooking",
  ready: "Ready",
  done: "Ready",
};

type CustomerProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  drop_address: string | null;
};

type OrderRow = DeliveryOrder & {
  route: Route | null;
  assignment: Assignment | null;
  rider: Staff | null;
  coord: { lat: number; lng: number } | null;
};

/** Orders that still need (or already have) a rider — delivered/cancelled are history. */
const LIVE_STATUSES = ["pending", "accepted", "preparing", "ready", "assigned", "picked_up"];

export default function DispatchBoard() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, CustomerProfile>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRider, setFocusRider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showRoute, setShowRoute] = useState<Record<string, boolean>>({});

  const layerRef = useRef<LeafletNs.LayerGroup | null>(null);
  const LRef = useRef<typeof LeafletNs | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const [ordersRes, routesRes, staffRes, assignRes] = await Promise.all([
        sb
          .from("orders")
          .select(
            "id, customer_id, status, total_ksh, is_paid, drop_note, drop_lat, drop_lng, route_id, receiver, receiver_phone, cook_status, delivery_status, created_at, drop_address, due_from, due_by"
          )
          .in("status", LIVE_STATUSES)
          // Pickup orders are handed over at the counter and never need a rider.
          .eq("fulfilment", "delivery")
          .order("due_by", { ascending: true }),
        sb.from("routes").select("id, name, color").order("name"),
        sb
          .from("profiles")
          .select("id, full_name, role, is_active, max_stops")
          .eq("role", "rider")
          .eq("is_active", true)
          .order("full_name"),
        sb.from("deliveries").select("id, order_id, rider_id, status").in("status", ["assigned", "picked_up"]),
      ]);
      const firstErr = [ordersRes, routesRes, staffRes, assignRes].map((r) => r.error).find(Boolean);
      if (firstErr) throw firstErr;

      const nextOrders = (ordersRes.data as DeliveryOrder[]) ?? [];
      setOrders(nextOrders);
      setRoutes((routesRes.data as Route[]) ?? []);
      setStaff((staffRes.data as Staff[]) ?? []);
      setAssignments((assignRes.data as Assignment[]) ?? []);

      const customerIds = [...new Set(nextOrders.map((o) => o.customer_id))];
      if (customerIds.length > 0) {
        const { data: profs } = await sb
          .from("profiles")
          .select("id, full_name, phone, drop_address")
          .in("id", customerIds);
        const map: Record<string, CustomerProfile> = {};
        ((profs as CustomerProfile[]) ?? []).forEach((p) => {
          map[p.id] = p;
        });
        setProfiles(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the dispatch board.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Today's board carries today's work (and anything overdue). Orders booked
  // for a later day are counted but kept off the map until their day comes.
  const now = new Date();
  const laterCount = orders.filter((o) => !isDueToday(o.due_from, now)).length;

  const rows: OrderRow[] = useMemo(
    () =>
      orders.filter((o) => isDueToday(o.due_from, new Date())).map((o) => {
        const route = routes.find((r) => r.id === o.route_id) ?? null;
        const assignment = assignments.find((a) => a.order_id === o.id) ?? null;
        const rider = staff.find((s) => s.id === assignment?.rider_id) ?? null;
        const coord =
          o.drop_lat != null && o.drop_lng != null ? { lat: o.drop_lat, lng: o.drop_lng } : null;
        return { ...o, route, assignment, rider, coord };
      }),
    [orders, routes, assignments, staff]
  );

  const unassigned = rows.filter((r) => !r.rider);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  /** Per-rider aggregates: stop count, planned distance, overload state. */
  const riderRuns = useMemo(() => {
    return staff.map((rider) => {
      const stops = rows.filter((r) => r.rider?.id === rider.id);
      const coords = stops.filter((s) => s.coord).map((s) => ({ id: s.id, ...s.coord! }));
      return {
        rider,
        stops,
        distanceKm: coords.length > 0 ? routeDistanceKm(coords) : 0,
        cap: capacityState(stops.length, rider.max_stops),
      };
    });
  }, [staff, rows]);

  const { containerRef, mapRef } = useLeafletMap(
    [DEPOT.lat, DEPOT.lng],
    11,
    (L, map) => {
      LRef.current = L;
      layerRef.current = L.layerGroup().addTo(map);
    }
  );

  // Mirror the React state onto the Leaflet layer.
  useEffect(() => {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;

    layer.clearLayers();

    L.marker([DEPOT.lat, DEPOT.lng], { icon: depotIcon(L), title: "Butchery (pickup)" })
      .bindTooltip("Butchery — pickup point", { direction: "top" })
      .addTo(layer);

    // One polyline per route: depot → stops in driving order → back.
    riderRuns.forEach((run) => {
      if (showRoute[run.rider.id] === false) return;
      const coords = run.stops.filter((s) => s.coord).map((s) => ({ id: s.id, ...s.coord! }));
      if (coords.length === 0) return;
      const ordered = sequenceStops(coords);
      const color = pinColor(run.stops[0]?.route?.color);
      L.polyline(
        [[DEPOT.lat, DEPOT.lng], ...ordered.map((c) => [c.lat, c.lng] as [number, number]), [DEPOT.lat, DEPOT.lng]],
        { color, weight: 3, opacity: 0.75, dashArray: "6 6" }
      ).addTo(layer);
    });

    const focused = new Set(riderRuns.filter((r) => r.rider.id === focusRider).flatMap((r) => r.stops.map((s) => s.id)));

    rows.forEach((row) => {
      if (!row.coord) return;
      const color = pinColor(row.route?.color);
      const isSelected = row.id === selectedId;
      const emphasised = isSelected || focused.has(row.id);
      const marker = L.marker([row.coord.lat, row.coord.lng], {
        icon: pinIcon(L, color, row.rider ? "•" : "+", emphasised),
        zIndexOffset: isSelected ? 1000 : emphasised ? 500 : 0,
        title: row.receiver ?? row.drop_note ?? row.id.slice(0, 8),
      });
      marker.on("click", () => {
        setSelectedId(row.id);
        if (!row.coord) return;
        mapRef.current?.panTo([row.coord.lat, row.coord.lng]);
      });
      marker.addTo(layer);
    });
  }, [rows, riderRuns, selectedId, focusRider, showRoute, mapRef]);

  const assign = async (orderRow: OrderRow, riderId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      if (riderId === null) {
        // Remove from the run: drop the delivery row, park the order back to "ready".
        if (orderRow.assignment) {
          const { error: dErr } = await sb.from("deliveries").delete().eq("id", orderRow.assignment.id);
          if (dErr) throw dErr;
        }
        // deliveries.status is the source of truth; sync_delivery_status() moves
        // orders.delivery_status (and therefore the legacy rollup) back to unassigned.
        await load();
        return;
      }

      const rider = staff.find((s) => s.id === riderId);
      const current = rows.filter((r) => r.rider?.id === riderId);
      if (rider && current.length >= rider.max_stops && orderRow.rider?.id !== riderId) {
        const proceed = window.confirm(
          `${rider.full_name ?? "This rider"} already has ${current.length} of ${rider.max_stops} stops.\n\nAssign anyway?`
        );
        if (!proceed) return;
      }

      if (orderRow.assignment) {
        const { error: uErr } = await sb
          .from("deliveries")
          .update({ rider_id: riderId })
          .eq("id", orderRow.assignment.id);
        if (uErr) throw uErr;
      } else {
        const { error: iErr } = await sb
          .from("deliveries")
          .insert({ order_id: orderRow.id, rider_id: riderId, status: "assigned" });
        if (iErr) throw iErr;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div>
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
            Route planning · static map
          </p>
          <h2 className="text-lg font-light tracking-tighter text-neutral-900">
            Dispatch map — pins by direction
          </h2>
          <p className="mt-0.5 text-[0.7rem] text-neutral-500">
            Pins are customer drops grouped by route colour. Click a pin to add or remove that order
            from a rider's run. No live tracking.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || busy}
          className="cursor-pointer border border-neutral-900 bg-white px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
        {/* ---------------- Map ---------------- */}
        <div className="relative min-h-[420px] border-b border-neutral-200 lg:border-b-0 lg:border-r">
          <div ref={containerRef} className="h-[420px] w-full bg-neutral-100 lg:h-[640px]" />
          <div className="pointer-events-none absolute left-3 top-3 z-[500] max-h-[70%] overflow-auto border border-neutral-200 bg-white/95 px-2.5 py-2 shadow-sm">
            <p className="mb-1.5 text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
              Directions
            </p>
            {routes.length === 0 ? (
              <p className="text-[0.65rem] text-neutral-400">No routes defined.</p>
            ) : (
              routes.map((r) => {
                const count = rows.filter((row) => row.route?.id === r.id).length;
                return (
                  <p key={r.id} className="flex items-center gap-1.5 text-[0.65rem] text-neutral-700">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: pinColor(r.color) }}
                    />
                    <span className="truncate">{r.name}</span>
                    <span className="ml-auto pl-2 font-mono text-[0.6rem] text-neutral-400">{count}</span>
                  </p>
                );
              })
            )}
            <p className="mt-1.5 flex items-center gap-1.5 border-t border-neutral-200 pt-1.5 text-[0.6rem] text-neutral-500">
              <span className="inline-block h-2.5 w-2.5 shrink-0 bg-neutral-900 ring-2 ring-[#ffe500]" /> Butchery
            </p>
          </div>
          {mapError && (
            <p className="absolute bottom-2 left-3 z-[500] bg-white/95 px-2 py-1 text-[0.65rem] text-red-700">
              {mapError}
            </p>
          )}
        </div>

        {/* ---------------- Side panel ---------------- */}
        <div className="flex max-h-[640px] flex-col overflow-auto">
          {selected ? (
            <div className="border-b border-neutral-200 p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
                    Selected order
                  </p>
                  <p className="font-mono text-xs text-neutral-900">{selected.id.slice(0, 8)}…</p>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="cursor-pointer text-[0.6rem] font-bold uppercase tracking-widest text-neutral-400 hover:text-neutral-900"
                >
                  Close
                </button>
              </div>
              {selected.route && (
                <p className="mb-2 flex items-center gap-1.5 text-[0.7rem] text-neutral-700">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: pinColor(selected.route.color) }}
                  />
                  {selected.route.name}
                </p>
              )}
              <dl className="mb-3 space-y-1 text-[0.7rem]">
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">Customer</dt>
                  <dd className="truncate text-right text-neutral-800">
                    {profiles[selected.customer_id]?.full_name || "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">Phone</dt>
                  <dd className="text-right text-neutral-800">
                    {selected.receiver_phone || profiles[selected.customer_id]?.phone || "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">Drop</dt>
                  <dd className="max-w-[60%] text-right text-neutral-800">
                    {selected.drop_address || profiles[selected.customer_id]?.drop_address || "—"}
                    {selected.drop_note && (
                      <span className="block text-neutral-500">{selected.drop_note}</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">Due</dt>
                  <dd className={`text-right font-semibold ${DUE_CLS[dueLabel(selected, now).tone]}`}>
                    {dueLabel(selected, now).text}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">Kitchen</dt>
                  <dd
                    className={`text-right font-semibold ${
                      selected.cook_status === "ready" || selected.cook_status === "done"
                        ? "text-green-700"
                        : "text-neutral-800"
                    }`}
                  >
                    {COOK_LABEL[selected.cook_status] ?? selected.cook_status}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">Order</dt>
                  <dd className="text-right text-neutral-800">
                    KSh {selected.total_ksh.toLocaleString()} · {selected.is_paid ? "paid" : "unpaid"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">Pinned</dt>
                  <dd className="text-right text-neutral-800">
                    {selected.coord ? "yes" : "no coordinates"}
                  </dd>
                </div>
              </dl>

              <p className="mb-1 text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
                {selected.rider ? "On this rider's run" : "Not assigned"}
              </p>
              <p className="mb-2 text-[0.7rem] text-neutral-700">
                {selected.rider ? selected.rider.full_name || "Rider" : "—"}
              </p>

              <div className="space-y-1.5">
                {staff.map((rider) => {
                  const count = rows.filter((r) => r.rider?.id === rider.id).length;
                  const isCurrent = selected.rider?.id === rider.id;
                  const over = count >= rider.max_stops && !isCurrent;
                  return (
                    <button
                      key={rider.id}
                      disabled={busy || isCurrent}
                      onClick={() => void assign(selected, rider.id)}
                      className={`flex w-full cursor-pointer items-center justify-between gap-2 border px-2.5 py-2 text-left text-[0.7rem] transition-colors disabled:cursor-default ${
                        isCurrent
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-900"
                      }`}
                    >
                      <span className="truncate">{rider.full_name || "Rider"}</span>
                      <span
                        className={`shrink-0 font-mono text-[0.6rem] ${
                          over ? "text-red-600" : isCurrent ? "text-[#ffe500]" : "text-neutral-400"
                        }`}
                      >
                        {capacityLabel(count, rider.max_stops)}
                        {over ? " ⚠" : ""}
                      </span>
                    </button>
                  );
                })}
                {selected.rider && (
                  <button
                    disabled={busy}
                    onClick={() => void assign(selected, null)}
                    className="w-full cursor-pointer border border-red-200 bg-red-50 px-2.5 py-2 text-[0.65rem] font-bold uppercase tracking-widest text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
                  >
                    Remove from run
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="border-b border-neutral-200 p-4">
              <p className="text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
                Unassigned · {unassigned.length}
              </p>
              {unassigned.length === 0 ? (
                <p className="mt-1 text-[0.7rem] text-neutral-400">Every order due today has a rider.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {unassigned.map((row) => (
                    <li key={row.id}>
                      <button
                        onClick={() => {
                          setSelectedId(row.id);
                          if (row.coord) mapRef.current?.setView([row.coord.lat, row.coord.lng], 14);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 border border-neutral-200 px-2 py-1.5 text-left text-[0.7rem] hover:border-neutral-900"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: pinColor(row.route?.color) }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {row.receiver || profiles[row.customer_id]?.full_name || row.id.slice(0, 8)}
                          </span>
                          <span className={`block truncate text-[0.6rem] ${DUE_CLS[dueLabel(row, now).tone]}`}>
                            {dueLabel(row, now).text}
                          </span>
                        </span>
                        <span className="shrink-0 text-right font-mono text-[0.6rem] text-neutral-400">
                          <span
                            className={`block font-sans font-bold uppercase tracking-wider ${
                              row.cook_status === "ready" || row.cook_status === "done"
                                ? "text-green-700"
                                : "text-neutral-400"
                            }`}
                          >
                            {COOK_LABEL[row.cook_status] ?? row.cook_status}
                          </span>
                          {row.coord ? "pinned" : "no pin"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {laterCount > 0 && (
                <p className="mt-2 text-[0.65rem] text-neutral-500">
                  {laterCount} more booked for later days. They appear here on the day.
                </p>
              )}
            </div>
          )}

          <div className="p-4">
            <p className="mb-2 text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
              Rider runs
            </p>
            {riderRuns.length === 0 ? (
              <p className="text-[0.7rem] text-neutral-400">No active riders.</p>
            ) : (
              <ul className="space-y-2">
                {riderRuns.map((run) => {
                  const color = pinColor(run.stops[0]?.route?.color ?? "#737373");
                  const isFocused = focusRider === run.rider.id;
                  return (
                    <li
                      key={run.rider.id}
                      className={`border p-2 ${isFocused ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"}`}
                    >
                      <button
                        onClick={() => setFocusRider(isFocused ? null : run.rider.id)}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                      >
                        <span className="truncate text-[0.75rem] text-neutral-900">
                          {run.rider.full_name || "Rider"}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[0.6rem] ${
                            run.cap === "over"
                              ? "text-red-600"
                              : run.cap === "near"
                                ? "text-amber-600"
                                : "text-neutral-400"
                          }`}
                        >
                          {capacityLabel(run.stops.length, run.rider.max_stops)}
                        </span>
                      </button>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[0.6rem] text-neutral-500">
                          ≈ {formatKm(run.distanceKm)} round trip
                        </span>
                        <label className="flex cursor-pointer items-center gap-1 text-[0.6rem] text-neutral-500">
                          <input
                            type="checkbox"
                            checked={showRoute[run.rider.id] !== false}
                            onChange={(e) =>
                              setShowRoute((prev) => ({ ...prev, [run.rider.id]: e.target.checked }))
                            }
                          />
                          line
                        </label>
                      </div>
                      {run.stops.length > 0 && (
                        <div className="mt-1.5 h-1 w-full" style={{ background: withAlpha(color, 0.25) }}>
                          <div
                            className="h-1"
                            style={{
                              width: `${Math.min(100, (run.stops.length / Math.max(1, run.rider.max_stops)) * 100)}%`,
                              background: run.cap === "over" ? "#dc2626" : color,
                            }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
