import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase, type AppRole } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import AuthLayout, {
  errorBoxCls,
  infoBoxCls,
  inputCls,
  labelCls,
  primaryBtnCls,
} from "../auth/AuthLayout";
import PasswordInput from "../auth/PasswordInput";
import { homeForRole } from "../auth/roles";
import SetupNotice from "../components/SetupNotice";
import { authErrorDetail, describeAuthError } from "../lib/authErrors";

/**
 * Email+password login with TOTP second step when the account has a
 * verified factor. All failures show GENERIC messages (anti-enumeration,
 * audit §6.4). Staff without MFA are forced through /mfa-enroll by
 * RequireRole after login.
 */
export default function LoginPage() {
  const { configured, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!configured) return <SetupNotice />;

  const roleAndGo = async (userId: string) => {
    const { data } = await getSupabase()
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    const role = (data?.role as AppRole | undefined) ?? "customer";
    await refreshProfile();
    navigate(homeForRole(role), { replace: true });
  };

  const handleCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDetail(null);
    setBusy(true);
    try {
      const sb = getSupabase();
      const { data, error: signErr } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signErr || !data.user) {
        setError(describeAuthError(signErr) ?? "Invalid email or password. Please try again.");
        setDetail(authErrorDetail(signErr));
        return;
      }
      const { data: factors } = await sb.auth.mfa.listFactors();
      const verified =
        factors?.totp?.filter((f) => f.status === "verified") ?? [];
      if (verified.length > 0 && verified[0]) {
        const { data: ch, error: chErr } = await sb.auth.mfa.challenge({
          factorId: verified[0].id,
        });
        if (chErr || !ch) {
          setError("Could not start the MFA challenge. Please try again.");
          return;
        }
        setFactorId(verified[0].id);
        setChallengeId(ch.id);
        setStep("mfa");
        return;
      }
      await roleAndGo(data.user.id);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleMfa = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDetail(null);
    setBusy(true);
    try {
      const sb = getSupabase();
      const { data, error: vErr } = await sb.auth.mfa.verify({
        factorId,
        challengeId,
        code: code.trim().replace(/\s+/g, ""),
      });
      if (vErr || !data.user) {
        setError("Invalid authentication code. Please try again.");
        setDetail(authErrorDetail(vErr));
        return;
      }
      await roleAndGo(data.user.id);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      kicker="Team & customer access"
      title={step === "mfa" ? "Enter your code" : "Sign in"}
      subtitle={
        step === "mfa"
          ? "Open your authenticator app and enter the 6-digit code."
          : "Staff and customers sign in here. Riders and managers get their accounts from an admin."
      }
    >
      {error && (
        <div className={errorBoxCls}>
          {error}
          {detail && (
            <details className="mt-1.5 opacity-70">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <p className="mt-1 break-words font-mono text-[0.65rem] leading-snug">{detail}</p>
            </details>
          )}
        </div>
      )}

      {step === "credentials" ? (
        <form onSubmit={handleCredentials} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="email">Email</label>
            <input
              id="email" type="email" required autoComplete="email"
              className={inputCls} placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="password">Password</label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={setPassword}
            />
          </div>
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="flex items-center justify-between pt-1 text-xs">
            <Link to="/forgot-password" className="text-neutral-500 underline hover:text-neutral-900">
              Forgot password?
            </Link>
            <Link to="/signup" className="text-neutral-500 underline hover:text-neutral-900">
              New customer? Sign up
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={handleMfa} className="space-y-4">
          <div className={infoBoxCls}>
            Password accepted. This account is protected with two-factor
            authentication.
          </div>
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
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>
          <button
            type="button"
            onClick={() => { setStep("credentials"); setCode(""); setError(null); }}
            className="w-full py-1 text-center text-xs text-neutral-500 underline hover:text-neutral-900"
          >
            Back to password
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
