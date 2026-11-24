import { useCallback, useEffect, useState } from "react";
import { getSupabase, type AppRole } from "../lib/supabase";
import PortalShell, {
  Card,
  Empty,
  portalErrorCls,
  smallBtnCls,
  tdCls,
  thCls,
} from "../auth/PortalShell";

type Profile = {
  id: string;
  full_name: string | null;
  role: AppRole;
  phone: string | null;
  is_active: boolean;
  created_at: string;
};

type AuditRow = {
  id: number;
  actor_id: string | null;
  action: string;
  object_type: string;
  object_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

const ROLES: AppRole[] = ["customer", "rider", "manager", "admin"];

/**
 * Admin panel (audit P-16/17/20): role assignment + full audit trail.
 * The ONLY place roles can change — enforced by RLS + DB trigger (SoD).
 * Users must re-login after a role change so their JWT claim refreshes.
 */
export default function AdminApp() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const [profilesRes, auditRes] = await Promise.all([
        sb.from("profiles").select("id, full_name, role, phone, is_active, created_at")
          .order("created_at", { ascending: false }).limit(100),
        sb.from("audit_logs").select("id, actor_id, action, object_type, object_id, details, created_at")
          .order("id", { ascending: false }).limit(50),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (auditRes.error) throw auditRes.error;
      setProfiles((profilesRes.data as Profile[]) ?? []);
      setAudit((auditRes.data as AuditRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setRole = async (id: string, role: AppRole) => {
    setBusy(id);
    setError(null);
    try {
      const { error: uErr } = await getSupabase()
        .from("profiles")
        .update({ role })
        .eq("id", id);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Role change rejected.");
    } finally {
      setBusy(null);
    }
  };

  const setActive = async (id: string, next: boolean) => {
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

  return (
    <PortalShell kicker="Admin · Access control" title="Users & audit trail">
      {error && <div className={portalErrorCls}>{error}</div>}
      {loading ? (
        <p className="py-8 text-center text-xs uppercase tracking-widest text-neutral-400">
          Loading…
        </p>
      ) : (
        <>
          <Card title="All users — assign roles">
            {profiles.length === 0 ? (
              <Empty text="No users yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Name</th>
                      <th className={thCls}>Phone</th>
                      <th className={thCls}>Role</th>
                      <th className={thCls}>Status</th>
                      <th className={thCls}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map((p) => (
                      <tr key={p.id}>
                        <td className={tdCls}>
                          {p.full_name || "—"}
                          <span className="block font-mono text-[0.6rem] text-neutral-400">
                            {p.id.slice(0, 8)}…
                          </span>
                        </td>
                        <td className={tdCls}>{p.phone || "—"}</td>
                        <td className={tdCls}>
                          <select
                            disabled={busy === p.id}
                            value={p.role}
                            onChange={(e) => void setRole(p.id, e.target.value as AppRole)}
                            className="border border-neutral-300 bg-white px-1 py-1 text-xs"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        <td className={tdCls}>{p.is_active ? "Active" : "Disabled"}</td>
                        <td className={tdCls}>
                          <button
                            disabled={busy === p.id}
                            onClick={void setActive(p.id, !p.is_active)}
                            className={smallBtnCls}
                          >
                            {p.is_active ? "Disable" : "Enable"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="pt-3 text-[0.65rem] leading-relaxed text-neutral-400">
              Every change is logged below and the user must sign in again for
              the new role to take effect. To invite staff: create their account
              in Supabase Dashboard → Authentication → Users → Invite, then set
              the role here.
            </p>
          </Card>

          <Card title="Audit trail (latest 50)">
            {audit.length === 0 ? (
              <Empty text="No audited events yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Time</th>
                      <th className={thCls}>Actor</th>
                      <th className={thCls}>Action</th>
                      <th className={thCls}>Object</th>
                      <th className={thCls}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id}>
                        <td className={`${tdCls} whitespace-nowrap`}>
                          {new Date(a.created_at).toLocaleString()}
                        </td>
                        <td className={`${tdCls} font-mono`}>
                          {a.actor_id ? `${a.actor_id.slice(0, 8)}…` : "system"}
                        </td>
                        <td className={`${tdCls} font-mono`}>{a.action}</td>
                        <td className={`${tdCls} font-mono`}>
                          {a.object_type}:{a.object_id.slice(0, 8)}
                        </td>
                        <td className={`${tdCls} max-w-56 truncate font-mono`}>
                          {JSON.stringify(a.details)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </PortalShell>
  );
}
