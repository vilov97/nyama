import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import AuthLayout, { infoBoxCls, inputCls, labelCls, primaryBtnCls } from "../auth/AuthLayout";
import SetupNotice from "../components/SetupNotice";

/**
 * Password reset request. ALWAYS shows the same message (anti-enumeration,
 * audit §6.4). Reset links are single-use with ≤1h expiry (Supabase Auth).
 */
export default function ForgotPasswordPage() {
  const { configured } = useAuth();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!configured) return <SetupNotice />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/login`,
      });
    } catch {
      // Deliberately ignored — same message either way.
    } finally {
      setBusy(false);
      setDone(true);
    }
  };

  return (
    <AuthLayout
      kicker="Account recovery"
      title="Reset password"
      subtitle="Enter your account email and we'll send a reset link."
    >
      {done ? (
        <div>
          <div className={infoBoxCls}>
            If an account exists for that email, a reset link is on its way.
            The link expires in one hour and can only be used once.
          </div>
          <Link to="/login" className={`${primaryBtnCls} block text-center no-underline`}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="email">Email</label>
            <input
              id="email" type="email" required autoComplete="email" className={inputCls}
              placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <p className="pt-1 text-center text-xs text-neutral-500">
            <Link to="/login" className="underline hover:text-neutral-900">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
