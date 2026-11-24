import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import AuthLayout, {
  errorBoxCls,
  infoBoxCls,
  inputCls,
  labelCls,
  primaryBtnCls,
} from "../auth/AuthLayout";
import { homeForRole } from "../auth/roles";
import SetupNotice from "../components/SetupNotice";

/**
 * TOTP enrollment for staff. Managers/admins cannot reach their dashboards
 * until a factor is verified (RequireRole gate, audit F-08).
 */
export default function MfaEnrollPage() {
  const { configured, user, role, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);

  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!configured || !user || started.current) return;
    started.current = true;
    const run = async () => {
      try {
        const sb = getSupabase();
        const { data: existing } = await sb.auth.mfa.listFactors();
        if (existing?.totp?.some((f) => f.status === "verified")) {
          await refreshProfile();
          navigate(homeForRole(role), { replace: true });
          return;
        }
        const { data, error: enrollErr } = await sb.auth.mfa.enroll({
          factorType: "totp",
        });
        if (enrollErr || !data) {
          setError("Could not start MFA enrollment. Please try again.");
          return;
        }
        setFactorId(data.id);
        setQr(data.totp.qr_code);
        setSecret(data.totp.secret);
      } catch {
        setError("Could not start MFA enrollment. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [configured, user, role, refreshProfile, navigate]);

  if (!configured) return <SetupNotice />;

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: vErr } = await getSupabase().auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim().replace(/\s+/g, ""),
      });
      if (vErr) {
        setError("Invalid code. Check your authenticator app and try again.");
        return;
      }
      await refreshProfile();
      navigate(homeForRole(role), { replace: true });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      kicker="Two-factor setup"
      title="Protect your staff account"
      subtitle="Scan the code with Google Authenticator, 1Password, or any TOTP app, then enter the 6-digit code."
    >
      {error && <div className={errorBoxCls}>{error}</div>}
      {loading ? (
        <p className="py-6 text-center text-xs uppercase tracking-widest text-neutral-400">
          Generating code…
        </p>
      ) : (
        factorId && (
          <div className="space-y-4">
            {qr && (
              <div
                className="mx-auto w-fit border border-neutral-200 bg-white p-3"
                // Supabase returns a static QR <svg> (no scripts). Rendered as-is.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
            <div className={infoBoxCls}>
              Can&apos;t scan? Enter this secret manually:{" "}
              <code className="break-all font-bold">{secret}</code>
            </div>
            <form onSubmit={void handleVerify} className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="code">6-digit code</label>
                <input
                  id="code" inputMode="numeric" autoComplete="one-time-code" required
                  className={`${inputCls} text-center text-lg tracking-[0.3em]`}
                  placeholder="000000" maxLength={6}
                  value={code} onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <button type="submit" disabled={busy} className={primaryBtnCls}>
                {busy ? "Verifying…" : "Verify & finish"}
              </button>
            </form>
          </div>
        )
      )}
    </AuthLayout>
  );
}
