import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "../lib/supabase";
import PortalShell, { portalErrorCls, smallBtnCls } from "../auth/PortalShell";
import { dueLabel, type DueTone, type Fulfilment, type Substitution } from "../lib/checkout";

type CookStatus = "pending" | "accepted" | "preparing" | "ready" | "done";

type KitchenItem = { name: string; qty: number; unit: string; note: string | null };

type QueueOrder = {
  order_id: string;
  cook_status: CookStatus;
  delivery_status: string;
  fulfilment: Fulfilment;
  created_at: string;
  due_from: string;
  due_by: string;
  is_scheduled: boolean;
  is_today: boolean;
  receiver: string | null;
  substitution: Substitution;
  kitchen_note: string | null;
  items: KitchenItem[];
};

type Tab = "now" | "ready" | "later";

/** Must list exactly the columns public.kitchen_queue projects. */
const QUEUE_COLUMNS =
  "order_id, cook_status, delivery_status, fulfilment, created_at, due_from, due_by, is_scheduled, is_today, receiver, substitution, kitchen_note, items";

const SUBSTITUTION_FOR_KITCHEN: Record<Substitution, string> = {
  call_me: "tell the manager — the customer wants a call first",
  best_match: "give the closest cut",
  leave_out: "leave it out",
};

const TONE_CLS: Record<DueTone, string> = {
  later: "text-neutral-500",
  ok: "text-neutral-700",
  soon: "text-amber-700",
  late: "text-red-600",
};

/**
 * Kitchen portal.
 *
 * Reads public.kitchen_queue and writes through the kitchen_advance() RPC.
 * The kitchen holds no privileges at all on public.orders: RLS can filter rows
 * but never columns, so any SELECT policy there would hand a cook the order
 * total, the customer's phone number and their drop pin. The view does not
 * project those columns, and the RPC whitelists allowed transitions.
 *
 * Orders are worked by deadline, not by arrival: an order booked yesterday for
 * this afternoon and one placed five minutes ago sit in the same list, sorted
 * by when they are due. Orders booked for a later day stay out of the way.
 */
export default function KitchenApp() {
  const [orders, setOrders] = useState<QueueOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("now");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await getSupabase()
        .from("kitchen_queue")
        .select(QUEUE_COLUMNS)
        .order("due_by", { ascending: true });
      if (qErr) throw qErr;
      setOrders((data ?? []) as unknown as QueueOrder[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the kitchen queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const cooking = orders.filter((o) => o.cook_status !== "ready");
    return {
      now: cooking.filter((o) => o.is_today),
      later: cooking.filter((o) => !o.is_today),
      ready: orders.filter((o) => o.cook_status === "ready"),
    };
  }, [orders]);

  const advance = async (order: QueueOrder) => {
    const next: CookStatus | null =
      order.cook_status === "pending"
        ? "accepted"
        : order.cook_status === "accepted"
          ? "preparing"
          : order.cook_status === "preparing"
            ? "ready"
            : order.cook_status === "ready" && order.fulfilment === "pickup"
              ? "done"
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

  const now = new Date();
  const shown = groups[tab];
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "now", label: "Cook now" },
    { key: "ready", label: "Ready" },
    { key: "later", label: "Booked ahead" },
  ];

  return (
    <PortalShell kicker="Kitchen · Prep queue" title="What to cook next">
      {error && <div className={portalErrorCls}>{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`cursor-pointer border px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-widest transition-colors ${
              tab === t.key
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 text-neutral-600 hover:border-neutral-900"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 font-mono ${tab === t.key ? "text-[#ffe500]" : "text-neutral-400"}`}>
              {groups[t.key].length}
            </span>
          </button>
        ))}
        <button
          onClick={() => void load()}
          className="ml-auto cursor-pointer text-[0.6rem] font-bold uppercase tracking-widest text-neutral-500 hover:text-neutral-900"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-xs uppercase tracking-widest text-neutral-400">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="border border-neutral-200 bg-white px-4 py-10 text-center">
          <p className="text-sm text-neutral-500">
            {tab === "ready"
              ? "Nothing waiting to go out."
              : tab === "later"
                ? "No orders booked for later days."
                : "Nothing in the queue. Good moment for prep."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((o) => {
            const due = dueLabel(o, now);
            const urgent = tab === "now" && (due.tone === "late" || due.tone === "soon");
            return (
              <div
                key={o.order_id}
                className={`border bg-white p-4 ${
                  urgent ? (due.tone === "late" ? "border-red-400" : "border-amber-400") : "border-neutral-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-mono text-[0.65rem] text-neutral-400">
                      <span>#{o.order_id.slice(0, 6)}</span>
                      <span
                        className={`px-1.5 py-0.5 font-sans text-[0.55rem] font-bold uppercase tracking-widest ${
                          o.fulfilment === "pickup"
                            ? "bg-[#ffe500] text-neutral-900"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {o.fulfilment === "pickup" ? "Pickup" : "Delivery"}
                      </span>
                      {o.receiver && <span className="font-sans text-neutral-500">for {o.receiver}</span>}
                    </p>
                    <p className="mt-1 text-[0.7rem] font-bold uppercase tracking-widest text-neutral-500">
                      {o.cook_status === "pending"
                        ? "New order"
                        : o.cook_status === "accepted"
                          ? "Accepted"
                          : o.cook_status === "preparing"
                            ? "Cooking"
                            : o.fulfilment === "pickup"
                              ? "Ready at the counter"
                              : o.delivery_status === "assigned"
                                ? "Ready — rider assigned"
                                : "Ready — waiting for a rider"}
                    </p>
                  </div>
                  <p className={`text-right text-[0.7rem] font-bold ${TONE_CLS[due.tone]}`}>{due.text}</p>
                </div>

                {o.items.length === 0 ? (
                  <p className="mt-2 text-xs italic text-amber-700">
                    No items recorded on this order — ask the manager.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-1">
                    {o.items.map((it, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-sm text-neutral-800">
                        <span className="font-mono text-[0.75rem] font-bold text-neutral-900">{it.qty}×</span>
                        <span className="font-medium">{it.name}</span>
                        {it.unit && it.unit !== "each" && (
                          <span className="text-[0.65rem] uppercase tracking-wider text-neutral-400">{it.unit}</span>
                        )}
                        {it.note && <span className="text-[0.7rem] italic text-neutral-500">{it.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}

                {o.kitchen_note && (
                  <p className="mt-3 border-l-2 border-[#ffe500] pl-2 text-xs text-neutral-800">
                    <span className="text-[0.6rem] font-bold uppercase tracking-wider text-neutral-400">
                      Customer asks{" "}
                    </span>
                    {o.kitchen_note}
                  </p>
                )}
                {tab !== "ready" && (
                  <p className="mt-2 text-[0.7rem] text-neutral-500">
                    If a cut is out: {SUBSTITUTION_FOR_KITCHEN[o.substitution] ?? SUBSTITUTION_FOR_KITCHEN.call_me}.
                  </p>
                )}

                {(tab !== "ready" || o.fulfilment === "pickup") && (
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
                          : o.cook_status === "preparing"
                            ? "Mark ready"
                            : `Handed to ${o.receiver ?? "customer"}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[0.65rem] leading-relaxed text-neutral-400">
        This screen shows only what to cook and when. Prices, customer phone numbers and delivery
        addresses are not shown to the kitchen, and are blocked by the database as well.
      </p>
    </PortalShell>
  );
}
