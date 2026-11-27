import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";
import DispatchBoard from "./DispatchBoard";
import PortalShell, {
  Card,
  Empty,
  portalErrorCls,
  smallBtnCls,
  tdCls,
  thCls,
} from "../auth/PortalShell";
import { dueLabel } from "../lib/checkout";

type Order = {
  id: string;
  receiver: string | null;
  fulfilment: "delivery" | "pickup";
  status: string;
  total_ksh: number;
  is_paid: boolean;
  created_at: string;
  due_from: string;
  due_by: string;
};

/** Orders that are finished one way or another: no deadline left to show. */
const CLOSED = ["delivered", "collected", "cancelled", "failed"];

type Staff = {
  id: string;
  full_name: string | null;
  role: string;
  phone: string | null;
  is_active: boolean;
};

type MenuItem = {
  id: string;
  name: string;
  price_ksh: number;
  unit: string;
  is_available: boolean;
};

/**
 * Manager portal (audit P-02/05/09/10/15): dispatch overview, staff
 * enable/disable for RIDERS only (managers are admin-managed, P-16),
 * menu availability. Refund + dispatch-assignment UI lands in Phase 3.
 */
type ShiftRow = {
  shift_code: "morning" | "afternoon" | "evening";
  label: string;
  is_current: boolean;
  managers_rostered: number;
  kitchen_rostered: number;
  riders_rostered: number;
};

export default function ManagerApp() {
  const [stats, setStats] = useState({ orders: 0, pending: 0, activeRuns: 0 });
  const [orders, setOrders] = useState<Order[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const [ordersCount, pendingCount, runsCount, ordersRes, staffRes, menuRes, shiftRes] =
        await Promise.all([
          sb.from("orders").select("id", { count: "exact", head: true }),
          sb.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
          sb.from("deliveries").select("id", { count: "exact", head: true })
            .in("status", ["assigned", "picked_up"]),
          sb.from("orders").select("id, receiver, fulfilment, status, total_ksh, is_paid, created_at, due_from, due_by")
            .order("created_at", { ascending: false }).limit(15),
          sb.from("profiles").select("id, full_name, role, phone, is_active")
            .in("role", ["rider", "manager"]).order("role").order("full_name"),
          sb.from("menu_items").select("id, name, price_ksh, unit, is_available").order("name"),
          sb.from("shift_board").select("shift_code, label, is_current, managers_rostered, kitchen_rostered, riders_rostered"),
        ]);
      const firstErr = [ordersCount, pendingCount, runsCount, ordersRes, staffRes, menuRes, shiftRes]
        .map((r) => r.error).find(Boolean);
      if (firstErr) throw firstErr;
      setStats({
        orders: ordersCount.count ?? 0,
        pending: pendingCount.count ?? 0,
        activeRuns: runsCount.count ?? 0,
      });
      setOrders((ordersRes.data as Order[]) ?? []);
      setStaff((staffRes.data as Staff[]) ?? []);
      setMenu((menuRes.data as MenuItem[]) ?? []);
      setShifts((shiftRes.data as ShiftRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRiderActive = async (id: string, next: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const { error: uErr } = await getSupabase()
        .from("profiles")
        .update({ is_active: next })
        .eq("id", id);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update rejected.");
    } finally {
      setBusy(null);
    }
  };

  const toggleMenuItem = async (id: string, next: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const { error: uErr } = await getSupabase()
        .from("menu_items")
        .update({ is_available: next })
        .eq("id", id);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update rejected.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <PortalShell kicker="Manager · Command center" title="Today at the butchery">
      {error && <div className={portalErrorCls}>{error}</div>}

      {shifts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-px border border-neutral-200 bg-neutral-200">
          {shifts.map((sh) => {
            const unsupervised = sh.is_current && sh.managers_rostered === 0;
            return (
              <div
                key={sh.shift_code}
                className={`flex-1 px-3 py-2 ${
                  sh.is_current ? "bg-neutral-900 text-white" : "bg-white text-neutral-800"
                }`}
              >
                <p
                  className={`text-[0.55rem] font-bold uppercase tracking-[0.15em] ${
                    sh.is_current ? "text-[#ffe500]" : "text-neutral-400"
                  }`}
                >
                  {sh.label}
                  {sh.is_current ? " · on now" : ""}
                </p>
                <p
                  className={`mt-1 text-[0.65rem] ${
                    unsupervised ? "font-bold text-red-600" : sh.is_current ? "text-white" : "text-neutral-600"
                  }`}
                >
                  {sh.managers_rostered > 0
                    ? `${sh.managers_rostered} mgr`
                    : "no manager"}
                  {" · "}
                  {sh.kitchen_rostered} kitchen · {sh.riders_rostered} riders
                </p>
                {unsupervised && (
                  <p className="mt-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-red-500">
                    Needs cover
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {loading ? (
        <p className="py-8 text-center text-xs uppercase tracking-widest text-neutral-400">
          Loading…
        </p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            {[
              { label: "Total orders", value: stats.orders },
              { label: "Pending", value: stats.pending },
              { label: "Active runs", value: stats.activeRuns },
            ].map((s) => (
              <div key={s.label} className="border border-neutral-200 bg-white p-4 text-center">
                <p className="text-2xl font-bold tracking-tighter text-neutral-900">{s.value}</p>
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-neutral-400">
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          <DispatchBoard />

          <Card title="Recent orders">
            {orders.length === 0 ? (
              <Empty text="No orders yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Order</th>
                      <th className={thCls}>For</th>
                      <th className={thCls}>Type</th>
                      <th className={thCls}>Status</th>
                      <th className={thCls}>Due</th>
                      <th className={thCls}>Total</th>
                      <th className={thCls}>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const due = CLOSED.includes(o.status) ? null : dueLabel(o, new Date());
                      return (
                      <tr key={o.id}>
                        <td className={`${tdCls} font-mono`}>#{o.id.slice(0, 6)}</td>
                        <td className={tdCls}>{o.receiver || "—"}</td>
                        <td className={tdCls}>{o.fulfilment === "pickup" ? "Pickup" : "Delivery"}</td>
                        <td className={tdCls}>{o.status.replace("_", " ")}</td>
                        <td
                          className={`${tdCls} ${
                            due?.tone === "late"
                              ? "font-bold text-red-600"
                              : due?.tone === "soon"
                                ? "font-bold text-amber-700"
                                : ""
                          }`}
                        >
                          {due ? due.text : "—"}
                        </td>
                        <td className={tdCls}>KSh {o.total_ksh.toLocaleString()}</td>
                        <td className={tdCls}>{o.is_paid ? "Yes" : "No"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Staff — riders & managers">
            {staff.length === 0 ? (
              <Empty text="No staff accounts yet. New riders are invited by an admin, then appear here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Name</th>
                      <th className={thCls}>Role</th>
                      <th className={thCls}>Phone</th>
                      <th className={thCls}>Status</th>
                      <th className={thCls}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => (
                      <tr key={s.id}>
                        <td className={tdCls}>{s.full_name || "—"}</td>
                        <td className={tdCls}>{s.role}</td>
                        <td className={tdCls}>{s.phone || "—"}</td>
                        <td className={tdCls}>{s.is_active ? "Active" : "Disabled"}</td>
                        <td className={tdCls}>
                          {s.role === "rider" ? (
                            <button
                              disabled={busy === s.id}
                              onClick={() => void toggleRiderActive(s.id, !s.is_active)}
                              className={smallBtnCls}
                            >
                              {s.is_active ? "Disable" : "Enable"}
                            </button>
                          ) : (
                            <span className="text-[0.6rem] text-neutral-400">Admin-only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Menu availability">
            {menu.length === 0 ? (
              <Empty text="No menu items yet." />
            ) : (
              <div className="space-y-2">
                {menu.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-2"
                  >
                    <p className="text-sm text-neutral-800">
                      <span className="font-bold">{m.name}</span>{" "}
                      <span className="text-xs text-neutral-400">
                        KSh {m.price_ksh.toLocaleString()}/{m.unit}
                      </span>
                    </p>
                    <button
                      disabled={busy === m.id}
                      onClick={() => void toggleMenuItem(m.id, !m.is_available)}
                      className={smallBtnCls}
                    >
                      {m.is_available ? "Mark sold out" : "Mark available"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </PortalShell>
  );
}
