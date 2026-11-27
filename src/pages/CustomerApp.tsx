import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import PortalShell, { Card, Empty, portalErrorCls, smallBtnCls } from "../auth/PortalShell";
import { dueLabel, orderProgress, shopTime, type Fulfilment } from "../lib/checkout";
import { KSH } from "../components/CartDrawer";

type OrderItem = { name_snapshot: string; qty: number; unit: string };

type Order = {
  id: string;
  status: string;
  cook_status: string;
  delivery_status: string;
  fulfilment: Fulfilment;
  total_ksh: number;
  delivery_fee_ksh: number;
  is_paid: boolean;
  created_at: string;
  due_from: string;
  due_by: string;
  drop_address: string | null;
  order_items: OrderItem[];
};

type Placed = { order_id: string; total_ksh: number; due_from: string; due_by: string };

/**
 * Customer portal: own orders and where each one has got to.
 * RLS guarantees customers only ever see their own rows (T-RBAC-01).
 */
export default function CustomerApp() {
  const { user } = useAuth();
  const location = useLocation();
  const placed = (location.state as { placed?: Placed } | null)?.placed ?? null;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const [profileRes, ordersRes] = await Promise.all([
        sb.from("profiles").select("full_name, phone").eq("id", user.id).single(),
        sb
          .from("orders")
          .select(
            "id, status, cook_status, delivery_status, fulfilment, total_ksh, delivery_fee_ksh, is_paid, created_at, due_from, due_by, drop_address, order_items(name_snapshot, qty, unit)"
          )
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (profileRes.error) throw profileRes.error;
      if (ordersRes.error) throw ordersRes.error;
      setName((profileRes.data?.full_name as string) ?? "");
      setPhone((profileRes.data?.phone as string) ?? "");
      setOrders((ordersRes.data as unknown as Order[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your data.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  /** A customer may cancel only while the kitchen has not accepted the order. */
  const cancel = async (order: Order) => {
    if (!window.confirm("Cancel this order?")) return;
    setBusyId(order.id);
    setError(null);
    try {
      const { data, error: uErr } = await getSupabase()
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", order.id)
        .select("id");
      if (uErr) throw uErr;
      if (!data || data.length === 0) {
        throw new Error("The kitchen has already started this order, so it can no longer be cancelled here.");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the order.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const now = new Date();

  return (
    <PortalShell kicker="Customer · Online shop" title="My orders">
      {error && <div className={portalErrorCls}>{error}</div>}

      {placed && (
        <div role="status" className="mb-4 border border-green-300 bg-green-50 px-4 py-3">
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-green-800">
            Order received · #{placed.order_id.slice(0, 6)}
          </p>
          <p className="mt-0.5 text-sm text-green-900">
            {KSH(placed.total_ksh)} · expected {shopTime(placed.due_from)} – {shopTime(placed.due_by)}. You can
            follow it below.
          </p>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-2 border border-neutral-900 bg-neutral-900 px-4 py-3">
        <div>
          <p className="text-[0.55rem] font-bold uppercase tracking-[0.15em] text-[#ffe500]">Shop</p>
          <p className="text-sm font-bold text-white">Fresh cuts, delivered or ready to collect.</p>
        </div>
        <Link
          to="/shop"
          className={`${smallBtnCls} shrink-0 border-[#ffe500] bg-[#ffe500] text-neutral-900 no-underline`}
        >
          Order now
        </Link>
      </div>

      {loading ? (
        <p className="py-8 text-center text-xs uppercase tracking-widest text-neutral-400">Loading…</p>
      ) : (
        <>
          <Card title={`Orders (${orders.length})`}>
            {orders.length === 0 ? (
              <Empty text="No orders yet. Tap Order now to start one." />
            ) : (
              <ul className="space-y-3">
                {orders.map((o) => {
                  const progress = orderProgress(o);
                  const open = progress.state === "active";
                  const due = dueLabel(o, now);
                  return (
                    <li key={o.id} className="border border-neutral-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[0.65rem] text-neutral-400">
                            #{o.id.slice(0, 6)} · {o.fulfilment === "pickup" ? "Pickup" : "Delivery"} ·{" "}
                            {new Date(o.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
                          </p>
                          <p className="mt-1 text-sm text-neutral-800">
                            {o.order_items.length > 0
                              ? o.order_items.map((i) => `${i.qty}× ${i.name_snapshot}`).join(" · ")
                              : "—"}
                          </p>
                          {o.fulfilment === "delivery" && o.drop_address && (
                            <p className="mt-0.5 truncate text-[0.7rem] text-neutral-500">To {o.drop_address}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-neutral-900">{KSH(o.total_ksh)}</p>
                          <p
                            className={`text-[0.6rem] font-bold uppercase tracking-widest ${
                              o.is_paid ? "text-green-700" : "text-neutral-400"
                            }`}
                          >
                            {o.is_paid ? "Paid" : o.fulfilment === "pickup" ? "Pay at counter" : "Pay on delivery"}
                          </p>
                        </div>
                      </div>

                      {progress.state === "cancelled" ? (
                        <p className="mt-3 text-[0.65rem] font-bold uppercase tracking-widest text-neutral-400">
                          Cancelled
                        </p>
                      ) : progress.state === "failed" ? (
                        <p className="mt-3 text-[0.65rem] font-bold uppercase tracking-widest text-red-600">
                          Delivery failed — we will call you
                        </p>
                      ) : (
                        <ol className="mt-3 flex gap-1" aria-label="Order progress">
                          {progress.steps.map((step, i) => {
                            const reached = i <= progress.current;
                            return (
                              <li key={step} className="flex-1" aria-current={i === progress.current ? "step" : undefined}>
                                <div className={`h-1 ${reached ? "bg-neutral-900" : "bg-neutral-200"}`} />
                                <p
                                  className={`mt-1 text-[0.55rem] font-bold uppercase leading-tight tracking-wider ${
                                    i === progress.current
                                      ? "text-neutral-900"
                                      : reached
                                        ? "text-neutral-500"
                                        : "text-neutral-300"
                                  }`}
                                >
                                  {step}
                                </p>
                              </li>
                            );
                          })}
                        </ol>
                      )}

                      {open && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p
                            className={`text-[0.7rem] font-semibold ${
                              due.tone === "late" ? "text-red-600" : "text-neutral-600"
                            }`}
                          >
                            {due.tone === "late" ? "Running late — sorry. We are on it." : due.text}
                          </p>
                          {o.status === "pending" && (
                            <button
                              type="button"
                              disabled={busyId === o.id}
                              onClick={() => void cancel(o)}
                              className={smallBtnCls}
                            >
                              {busyId === o.id ? "Cancelling…" : "Cancel order"}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3 text-right">
              <button type="button" onClick={() => void load()} className={smallBtnCls}>
                Refresh
              </button>
            </div>
          </Card>

          <Card title="Profile">
            <div className="grid gap-2 text-sm text-neutral-700 sm:grid-cols-3">
              <div><span className="text-xs text-neutral-400">Name</span><p className="font-bold">{name || "—"}</p></div>
              <div><span className="text-xs text-neutral-400">Email</span><p className="font-bold">{user?.email}</p></div>
              <div><span className="text-xs text-neutral-400">Phone</span><p className="font-bold">{phone || "—"}</p></div>
            </div>
          </Card>
        </>
      )}
    </PortalShell>
  );
}
