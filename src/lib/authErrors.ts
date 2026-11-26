import type { AuthError } from "@supabase/supabase-js";

/**
 * Maps a Supabase Auth error to a message that is useful in the UI.
 *
 * Anti-enumeration rule (audit §6.4): failures that would reveal whether an
 * account exists ("invalid login credentials", "email not confirmed") keep a
 * neutral wording. Infrastructure failures — network/CORS blocks, rate limits,
 * server errors, misconfiguration — are NOT account-existence leaks, so they get
 * an honest, actionable message instead of the old catch-all.
 */
export function describeAuthError(err: AuthError | null | undefined): string | null {
  if (!err) return null;
  const code = String(err.code ?? "").toLowerCase();
  const msg = String(err.message ?? "").toLowerCase();
  const status = err.status ?? 0;

  // Network / CORS / DNS: fetch never reached Supabase.
  if (
    code === "request_failed" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    status === 0
  ) {
    return "Could not reach the authentication service. Check your connection — an ad-blocker, VPN or firewall may be blocking requests to Supabase.";
  }

  if (code === "over_email_send_rate_limit" || status === 429) {
    return "Too many attempts. Wait a minute and try again.";
  }

  // Account-existence sensitive → neutral wording.
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
    return "Invalid email or password. Please try again.";
  }
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return "Invalid email or password. Please try again.";
  }

  if (status >= 500) {
    return "The authentication service is having trouble. Please try again in a moment.";
  }

  return null; // caller falls back to its own generic copy
}

/** Technical detail for the collapsed diagnostics block (never the password). */
export function authErrorDetail(err: AuthError | null | undefined): string | null {
  if (!err) return null;
  const parts = [
    err.code ? `code: ${err.code}` : null,
    err.status ? `status: ${err.status}` : null,
    err.message ? `message: ${err.message}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
