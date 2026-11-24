import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import PortalShell, { Card, Empty, portalErrorCls, smallBtnCls } from "../auth/PortalShell";

type Delivery = {
  id: string;
  order_id: string;
  status: "assigned" | "picked_up" | string;
  created_at: string;
};

/**
 * Rider portal (audit P-11/12): assigned ACTIVE runs only. RLS hides every
 * other delivery (T-RBAC-03) and forbids reassignment (T-RBAC-04).
 */
export default function RiderApp() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await getSupabase()
        .from("deliveries")
        .select("id, order_id, status, created_at")
        .eq("rider_id", user.id)
        .in("status", ["assigned", "picked_up"])
        .order("created_at");
      if (qErr) throw qErr;
      setRuns((data as Delivery[]) ?? []);
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
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 border border-neutral-200 p-4"
                >
                  <div>
                    <p className="font-mono text-sm font-bold text-neutral-900">
                      Run {r.id.slice(0, 8)}…
                    </p>
                    <p className="mt-0.5 font-mono text-[0.65rem] text-neutral-400">
                      Order {r.order_id.slice(0, 8)}… · dispatched{" "}
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                    <p className="mt-1 inline-block bg-neutral-100 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-600">
                      {r.status.replace("_", " ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {r.status === "assigned" && (
                      <button
                        disabled={busyId === r.id}
                        onClick={void advance(r.id, "picked_up")}
                        className={smallBtnCls}
                      >
                        Mark picked up
                      </button>
                    )}
                    {r.status === "picked_up" && (
                      <>
                        <button
                          disabled={busyId === r.id}
                          onClick={void advance(r.id, "delivered")}
                          className={`${smallBtnCls} border-neutral-900 bg-[#ffe500] text-neutral-900`}
                        >
                          Mark delivered
                        </button>
                        <button
                          disabled={busyId === r.id}
                          onClick={void advance(r.id, "failed")}
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
                Customer contact and navigation for each run unlock in Phase 3.
                Delivered runs disappear from this list automatically.
              </p>
            </div>
          )}
        </Card>
      )}
    </PortalShell>
  );
}
