import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import AuthLayout, {
  errorBoxCls,
  infoBoxCls,
  inputCls,
  labelCls,
  primaryBtnCls,
} from "../auth/AuthLayout";
import PasswordInput from "../auth/PasswordInput";
import SetupNotice from "../components/SetupNotice";
import { authErrorDetail, describeAuthError } from "../lib/authErrors";

/**
 * Customer self-registration. New accounts are ALWAYS created with the
 * `customer` role by the DB trigger (audit §5.4) — privilege is granted
 * later by an admin only. "Already registered" returns the same message
 * as success (anti-enumeration, audit §6.4).
 */
export default function SignupPage() {
  const { configured } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!configured) return <SetupNotice />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDetail(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error: signErr } = await getSupabase().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: phone.trim() || null,
          },
        },
      });
      if (signErr) {
        // Anti-enumeration: same next step whether new or existing.
        if (/already (registered|exists)|already been registered/i.test(signErr.message)) {
          setDone(true);
          return;
        }
        if (/password/i.test(signErr.message)) {
          setError("That password is not allowed (too weak or previously breached). Try a longer, unique one.");
          return;
        }
        setError(describeAuthError(signErr) ?? "Could not create the account. Please try again.");
        setDetail(authErrorDetail(signErr));
        return;
      }
      setDone(true);
    } catch (err) {
      setError("Could not create the account. Please try again.");
      setDetail(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      kicker="New customer"
      title="Create your account"
      subtitle="Order nyama choma online and track delivery to your door."
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
      {done ? (
        <div>
          <div className={infoBoxCls}>
            If this email can receive mail, a confirmation link is on its way.
            Open it, then sign in below.
          </div>
          <Link to="/login" className={`${primaryBtnCls} block text-center no-underline`}>
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="name">Full name</label>
            <input
              id="name" required autoComplete="name" className={inputCls}
              placeholder="Jane Wanjiku" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="email">Email</label>
            <input
              id="email" type="email" required autoComplete="email" className={inputCls}
              placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="phone">
              M-Pesa phone <span className="font-normal normal-case">(optional)</span>
            </label>
            <input
              id="phone" type="tel" autoComplete="tel" className={inputCls}
              placeholder="+2547XXXXXXXX" value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="password">Password (8+ chars)</label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={setPassword}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="confirm">Confirm password</label>
              <PasswordInput
                id="confirm"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirm}
                onChange={setConfirm}
              />
            </div>
          </div>
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? "Creating…" : "Create account"}
          </button>
          <p className="pt-1 text-center text-xs text-neutral-500">
            Already have an account?{" "}
            <Link to="/login" className="underline hover:text-neutral-900">Sign in</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
