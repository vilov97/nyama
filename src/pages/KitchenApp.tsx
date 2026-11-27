import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";
import PortalShell, { portalErrorCls, smallBtnCls } from "../auth/PortalShell";

type CookStatus = "pending" | "accepted" | "preparing" | "ready" | "done";

type KitchenItem = { name: string; qty: number; unit: string; note: string | null };

type QueueOrder = {
  order_id: string;
  cook_status: CookStatus;
  delivery_status: string;
  receiver: string | null;
  drop_note: string | null;
  created_at: string;
  customer_name: string | null;
  items: KitchenItem[];
};

/**
 * Kitchen portal.
 *
 * Reads public.kitchen_queue and writes through the kitchen_advance() RPC.
 * The kitchen holds no privileges at all on public.orders: RLS can filter rows
 * but never columns, so any SELECT policy there would hand a cook the order
 * total, the customer's phone number and their drop pin. The view does not
 * project those columns, and the RPC whitelists allowed transitions.
 * That is the whole point of a separate `kitchen` role rather than handing out
 * manager accounts.
 */
export default function KitchenApp() {
  const [orders, setOrders] = useState<QueueOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "ready">("active");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const wanted: CookStatus[] =
        filter === "ready" ? ["ready"] : ["pending", "accepted", "preparing"];

      const { data, error: qErr } = await getSupabase()
        .from("kitchen_queue")
        .select("order_id, cook_status, delivery_status, receiver, drop_note, created_at, customer_name, items")
        .in("cook_status", wanted)
        .order("created_at", { ascending: true });
      if (qErr) throw qErr;

      setOrders((data ?? []) as QueueOrder[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the kitchen queue.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = async (order: QueueOrder) => {
    const next: CookStatus | null =
      order.cook_status === "pending"
        ? "accepted"
        : order.cook_status === "accepted"
          ? "preparing"
          : order.cook_status === "preparing"
            ? "ready"
            : null;
    if (!next) return;
    setBusyId(order.order_id);
    setError(null);
    try {
      // RPC, not a table update: the kitchen has no grants on public.orders,
      // which is what keeps prices and phone numbers out of reach.
      const { error: uErr } = await getSupabase().rpc("kitchen_advance", {
        p_order_id: order.order_id,
        p_next: next,
      });
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that order.");
    } finally {
      setBusyId(null);
    }
  };

  const minutesWaiting = (createdAt: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));

  return (
    <PortalShell kicker="Kitchen · Prep queue" title="What to cook next">
      {error && <div className={portalErrorCls}>{error}</div>}

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setFilter("active")}
          className={`cursor-pointer border px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-widest transition-colors ${
            filter === "active"
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-300 text-neutral-600 hover:border-neutral-900"
          }`}
        >
          To cook
        </button>
        <button
          onClick={() => setFilter("ready")}
          className={`cursor-pointer border px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-widest transition-colors ${
            filter === "ready"
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-300 text-neutral-600 hover:border-neutral-900"
          }`}
        >
          Ready for pickup
        </button>
        <button
          onClick={() => void load()}
          className="ml-auto cursor-pointer text-[0.6rem] font-bold uppercase tracking-widest text-neutral-500 hover:text-neutral-900"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-xs uppercase tracking-widest text-neutral-400">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="border border-neutral-200 bg-white px-4 py-10 text-center">
          <p className="text-sm text-neutral-500">
            {filter === "ready" ? "Nothing waiting for pickup." : "Nothing in the queue. Good moment for prep."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            const mins = minutesWaiting(o.created_at);
            const late = mins >= 20 && filter === "active";
            return (
              <div
                key={o.order_id}
                className={`border bg-white p-4 ${late ? "border-red-300" : "border-neutral-200"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[0.65rem] text-neutral-400">
                      #{o.order_id.slice(0, 6)}
                      {o.customer_name ? ` · ${o.customer_name}` : ""}
                    </p>
                    <p className="text-[0.7rem] font-bold uppercase tracking-widest text-neutral-500">
                      {o.cook_status === "pending"
                        ? "Awaiting acceptance"
                        : o.cook_status === "accepted"
                          ? "New order"
                          : o.cook_status === "preparing"
                            ? "Cooking"
                            : "Ready"}
                    </p>
                    {o.items.length === 0 ? (
                      <p className="mt-2 text-xs italic text-amber-700">
                        No items recorded on this order — ask the manager.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {o.items.map((it, i) => (
                          <li key={i} className="flex items-baseline gap-2 text-sm text-neutral-800">
                            <span className="font-mono text-[0.7rem] font-bold text-neutral-900">
                              {it.qty}×
                            </span>
                            <span className="font-medium">{it.name}</span>
                            {it.unit && it.unit !== "each" && (
                              <span className="text-[0.65rem] uppercase tracking-wider text-neutral-400">
                                {it.unit}
                              </span>
                            )}
                            {it.note && (
                              <span className="text-[0.7rem] italic text-neutral-500">{it.note}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {o.drop_note && (
                      <p className="mt-2 border-l-2 border-[#ffe500] pl-2 text-xs text-neutral-700">
                        <span className="font-bold uppercase tracking-wider text-[0.6rem] text-neutral-400">
                          Delivery note{" "}
                        </span>
                        {o.drop_note}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={`text-[0.65rem] font-bold ${late ? "text-red-600" : "text-neutral-400"}`}>
                      {mins} min
                    </p>
                  </div>
                </div>

                {filter === "active" && (
                  <button
                    disabled={busyId === o.order_id}
                    onClick={() => void advance(o)}
                    className={`${smallBtnCls} mt-3 w-full border-neutral-900 bg-[#ffe500] py-2.5 text-neutral-900 sm:w-auto sm:px-6`}
                  >
                    {busyId === o.order_id
                      ? "Saving…"
                      : o.cook_status === "pending"
                        ? "Accept order"
                        : o.cook_status === "accepted"
                          ? "Start cooking"
                          : "Mark ready"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[0.65rem] leading-relaxed text-neutral-400">
        This screen shows only what to cook. Prices, customer phone numbers and delivery
        locations are not shown to the kitchen, and are blocked by the database as well.
      </p>
    </PortalShell>
  );
}
