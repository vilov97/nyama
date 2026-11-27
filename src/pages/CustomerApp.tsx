import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { Link } from "react-router-dom";
import PortalShell, { Card, Empty, portalErrorCls, smallBtnCls, tdCls, thCls } from "../auth/PortalShell";

type Order = {
  id: string;
  status: string;
  total_ksh: number;
  is_paid: boolean;
  created_at: string;
};

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price_ksh: number;
  unit: string;
};

/**
 * Customer portal (audit P-03/04/06): own profile, own orders, public menu.
 * RLS guarantees customers only ever see their own rows (T-RBAC-01).
 */
export default function CustomerApp() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const [profileRes, ordersRes, menuRes] = await Promise.all([
        sb.from("profiles").select("full_name, phone").eq("id", user.id).single(),
        sb.from("orders").select("id, status, total_ksh, is_paid, created_at")
          .order("created_at", { ascending: false }).limit(20),
        sb.from("menu_items").select("id, name, description, price_ksh, unit")
          .eq("is_available", true).order("name"),
      ]);
      if (profileRes.error) throw profileRes.error;
      if (ordersRes.error) throw ordersRes.error;
      if (menuRes.error) throw menuRes.error;
      setName((profileRes.data?.full_name as string) ?? "");
      setPhone((profileRes.data?.phone as string) ?? "");
      setOrders((ordersRes.data as Order[]) ?? []);
      setMenu((menuRes.data as MenuItem[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your data.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PortalShell kicker="Customer · Online shop" title="My orders">
      {error && <div className={portalErrorCls}>{error}</div>}

      <div className="mb-4 flex items-center justify-between gap-2 border border-neutral-900 bg-neutral-900 px-4 py-3">
        <div>
          <p className="text-[0.55rem] font-bold uppercase tracking-[0.15em] text-[#ffe500]">
            Hungry?
          </p>
          <p className="text-sm font-bold text-white">Order now — we cut it when you order.</p>
        </div>
        <Link
          to="/app/new"
          className={`${smallBtnCls} shrink-0 border-[#ffe500] bg-[#ffe500] text-neutral-900`}
        >
          New order
        </Link>
      </div>

      {loading ? (
        <p className="py-8 text-center text-xs uppercase tracking-widest text-neutral-400">
          Loading…
        </p>
      ) : (
        <>
          <Card title="Profile">
            <div className="grid gap-2 text-sm text-neutral-700 sm:grid-cols-3">
              <div><span className="text-xs text-neutral-400">Name</span><p className="font-bold">{name || "—"}</p></div>
              <div><span className="text-xs text-neutral-400">Email</span><p className="font-bold">{user?.email}</p></div>
              <div><span className="text-xs text-neutral-400">Phone</span><p className="font-bold">{phone || "—"}</p></div>
            </div>
          </Card>

          <Card title="Order history">
            {orders.length === 0 ? (
              <Empty text="No orders yet. Tap New order to start one." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Order</th>
                      <th className={thCls}>Status</th>
                      <th className={thCls}>Total</th>
                      <th className={thCls}>Paid</th>
                      <th className={thCls}>Placed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td className={`${tdCls} font-mono`}>{o.id.slice(0, 8)}…</td>
                        <td className={tdCls}>{o.status}</td>
                        <td className={tdCls}>KSh {o.total_ksh.toLocaleString()}</td>
                        <td className={tdCls}>{o.is_paid ? "Yes" : "No"}</td>
                        <td className={tdCls}>{new Date(o.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Today's menu">
            {menu.length === 0 ? (
              <Empty text="Menu is being stocked by the butchery." />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {menu.map((m) => (
                  <div key={m.id} className="border border-neutral-200 p-3 text-center">
                    <p className="text-sm font-bold text-neutral-900">{m.name}</p>
                    {m.description && <p className="text-[0.6rem] text-neutral-400">{m.description}</p>}
                    <p className="mt-1 text-sm font-bold text-neutral-900">
                      KSh {m.price_ksh.toLocaleString()}
                      <span className="text-[0.55rem] font-normal text-neutral-400">/{m.unit}</span>
                    </p>
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
