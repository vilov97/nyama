import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import PortalShell, { Card, Empty, portalErrorCls, smallBtnCls } from "../auth/PortalShell";

type Run = {
  delivery_id: string;
  order_id: string;
  delivery_status: "assigned" | "picked_up" | string;
  created_at: string;
  receiver: string | null;
  receiver_phone: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  drop_note: string | null;
  total_ksh: number;
  is_paid: boolean;
  cook_status: string;
  items: Array<{ name: string; qty: number; unit: string }>;
};

/**
 * Rider portal (audit P-11/12): assigned ACTIVE runs only. RLS hides every
 * other delivery (T-RBAC-03) and forbids reassignment (T-RBAC-04).
 *
 * Reads public.rider_runs — a definer view scoped to rider_id = auth.uid().
 * Riders have no SELECT policy on `orders`, so this view is how they learn
 * where to go without being handed the whole order table.
 */
export default function RiderApp() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await getSupabase()
        .from("rider_runs")
        .select("delivery_id, order_id, delivery_status, created_at, receiver, receiver_phone, drop_lat, drop_lng, drop_note, total_ksh, is_paid, cook_status, items")
        .order("created_at");
      if (qErr) throw qErr;
      setRuns((data as Run[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your runs.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = async (id: string, next: "picked_up" | "delivered" | "failed") => {
    setBusyId(id);
    setError(null);
    try {
      const { error: uErr } = await getSupabase()
        .from("deliveries")
        .update({ status: next })
        .eq("id", id);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update rejected.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PortalShell kicker="Rider · Field interface" title="My runs">
      {error && <div className={portalErrorCls}>{error}</div>}
      {loading ? (
        <p className="py-8 text-center text-xs uppercase tracking-widest text-neutral-400">
          Loading…
        </p>
      ) : (
        <Card title={`Active runs (${runs.length})`}>
          {runs.length === 0 ? (
            <Empty text="No active runs. New dispatches from your manager will appear here." />
          ) : (
            <div className="space-y-3">
              {runs.map((r) => (
                <div
                  key={r.delivery_id}
                  className="border border-neutral-200 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-neutral-900">
                        {r.receiver ?? "Customer"}
                      </p>
                      <p className="mt-0.5 font-mono text-[0.65rem] text-neutral-400">
                        Order {r.order_id.slice(0, 8)}… · dispatched{" "}
                        {new Date(r.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`inline-block px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-widest ${
                          r.cook_status === "ready"
                            ? "bg-green-100 text-green-800"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {r.cook_status === "ready" ? "Ready" : r.cook_status.replace("_", " ")}
                      </p>
                      <p
                        className={`mt-1 text-[0.6rem] font-bold uppercase tracking-widest ${
                          r.is_paid ? "text-green-700" : "text-amber-700"
                        }`}
                      >
                        {r.is_paid ? "Paid" : `Collect KSh ${r.total_ksh.toLocaleString()}`}
                      </p>
                    </div>
                  </div>

                  {r.items.length > 0 && (
                    <p className="mt-2 text-xs text-neutral-700">
                      {r.items.map((i) => `${i.qty}× ${i.name}`).join(" · ")}
                    </p>
                  )}

                  {r.drop_note && (
                    <p className="mt-2 border-l-2 border-[#ffe500] pl-2 text-xs text-neutral-700">
                      {r.drop_note}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.drop_lat != null && r.drop_lng != null && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${r.drop_lat},${r.drop_lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className={smallBtnCls}
                      >
                        Navigate
                      </a>
                    )}
                    {r.receiver_phone && (
                      <a href={`tel:${r.receiver_phone}`} className={smallBtnCls}>
                        Call
                      </a>
                    )}
                    {r.delivery_status === "assigned" && (
                      <button
                        disabled={busyId === r.delivery_id}
                        onClick={() => void advance(r.delivery_id, "picked_up")}
                        className={smallBtnCls}
                      >
                        Picked up
                      </button>
                    )}
                    {r.delivery_status === "picked_up" && (
                      <>
                        <button
                          disabled={busyId === r.delivery_id}
                          onClick={() => void advance(r.delivery_id, "delivered")}
                          className={`${smallBtnCls} border-neutral-900 bg-[#ffe500] text-neutral-900`}
                        >
                          Delivered
                        </button>
                        <button
                          disabled={busyId === r.delivery_id}
                          onClick={() => void advance(r.delivery_id, "failed")}
                          className={smallBtnCls}
                        >
                          Failed
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <p className="pt-2 text-[0.65rem] leading-relaxed text-neutral-400">
                Navigate opens the drop pin in Maps. Delivered runs disappear from
                this list automatically, and a run is only yours while you hold it.
              </p>
            </div>
          )}
        </Card>
      )}
    </PortalShell>
  );
}
