import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";
import PortalShell, {
  Card,
  Empty,
  portalErrorCls,
  smallBtnCls,
  tdCls,
  thCls,
} from "../auth/PortalShell";

type Order = {
  id: string;
  customer_id: string;
  status: string;
  total_ksh: number;
  is_paid: boolean;
  created_at: string;
};

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
export default function ManagerApp() {
  const [stats, setStats] = useState({ orders: 0, pending: 0, activeRuns: 0 });
  const [orders, setOrders] = useState<Order[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const [ordersCount, pendingCount, runsCount, ordersRes, staffRes, menuRes] =
        await Promise.all([
          sb.from("orders").select("id", { count: "exact", head: true }),
          sb.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
          sb.from("deliveries").select("id", { count: "exact", head: true })
            .in("status", ["assigned", "picked_up"]),
          sb.from("orders").select("id, customer_id, status, total_ksh, is_paid, created_at")
            .order("created_at", { ascending: false }).limit(15),
          sb.from("profiles").select("id, full_name, role, phone, is_active")
            .in("role", ["rider", "manager"]).order("role").order("full_name"),
          sb.from("menu_items").select("id, name, price_ksh, unit, is_available").order("name"),
        ]);
      const firstErr = [ordersCount, pendingCount, runsCount, ordersRes, staffRes, menuRes]
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

          <Card title="Recent orders">
            {orders.length === 0 ? (
              <Empty text="No orders yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Order</th>
                      <th className={thCls}>Customer</th>
                      <th className={thCls}>Status</th>
                      <th className={thCls}>Total</th>
                      <th className={thCls}>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td className={`${tdCls} font-mono`}>{o.id.slice(0, 8)}…</td>
                        <td className={`${tdCls} font-mono`}>{o.customer_id.slice(0, 8)}…</td>
                        <td className={tdCls}>{o.status}</td>
                        <td className={tdCls}>KSh {o.total_ksh.toLocaleString()}</td>
                        <td className={tdCls}>{o.is_paid ? "Yes" : "No"}</td>
                      </tr>
                    ))}
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
