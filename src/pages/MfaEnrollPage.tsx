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
  const { configured, user, role, mfaStepUpRequired, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);

  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stepUp, setStepUp] = useState(false);

  useEffect(() => {
    if (!configured || !user || started.current) return;
    started.current = true;
    const run = async () => {
      try {
        const sb = getSupabase();
        const { data: existing, error: listErr } = await sb.auth.mfa.listFactors();
        if (listErr) {
          setError(`Could not read your security settings: ${listErr.message}`);
          return;
        }

        const verified = existing?.totp?.filter((f) => f.status === "verified") ?? [];

        // Already has a factor but this session is aal1 → challenge it instead
        // of enrolling a second one.
        if (verified.length > 0 || mfaStepUpRequired) {
          const factor = verified[0];
          if (!factor) {
            setError("You have a factor but it could not be loaded. Try signing out and in again.");
            return;
          }
          const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId: factor.id });
          if (chErr || !ch) {
            setError(`Could not start the verification: ${chErr?.message ?? "unknown error"}`);
            return;
          }
          setFactorId(factor.id);
          setChallengeId(ch.id);
          setStepUp(true);
          return;
        }

        const { data, error: enrollErr } = await sb.auth.mfa.enroll({ factorType: "totp" });
        if (enrollErr || !data) {
          setError(`Could not start MFA enrollment: ${enrollErr?.message ?? "unknown error"}`);
          return;
        }
        setFactorId(data.id);
        setQr(data.totp.qr_code);
        setSecret(data.totp.secret);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start MFA setup.");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [configured, user, mfaStepUpRequired]);

  if (!configured) return <SetupNotice />;

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const sb = getSupabase();
      const clean = code.trim().replace(/\s+/g, "");
      const { error: vErr } = stepUp
        ? await sb.auth.mfa.verify({ factorId, challengeId, code: clean })
        : await sb.auth.mfa.challengeAndVerify({ factorId, code: clean });

      if (vErr) {
        setError(
          vErr.message.toLowerCase().includes("expired")
            ? "That code expired. Reload the page to get a fresh one."
            : "Invalid code. Check your authenticator app and try again."
        );
        return;
      }
      await refreshProfile();
      navigate(homeForRole(role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      kicker={stepUp ? "Two-factor check" : "Two-factor setup"}
      title={stepUp ? "Confirm it's you" : "Protect your staff account"}
      subtitle={
        stepUp
          ? "Enter the 6-digit code from your authenticator app to finish signing in."
          : "Scan the code with Google Authenticator, 1Password, or any TOTP app, then enter the 6-digit code."
      }
    >
      {error && <div className={errorBoxCls}>{error}</div>}
      {loading ? (
        <p className="py-6 text-center text-xs uppercase tracking-widest text-neutral-400">
          Generating code…
        </p>
      ) : (
        factorId && (
          <div className="space-y-4">
            {!stepUp && qr && (
              <div
                className="mx-auto w-fit border border-neutral-200 bg-white p-3"
                // Supabase returns a static QR <svg> (no scripts). Rendered as-is.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
            {!stepUp && (
            <div className={infoBoxCls}>
              Can&apos;t scan? Enter this secret manually:{" "}
              <code className="break-all font-bold">{secret}</code>
            </div>
            )}
            <form onSubmit={handleVerify} className="space-y-4">
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
                {busy ? "Verifying…" : stepUp ? "Verify & sign in" : "Verify & finish"}
              </button>
            </form>
          </div>
        )
      )}
    </AuthLayout>
  );
}
