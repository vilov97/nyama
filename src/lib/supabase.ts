import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Canonical app roles — must match the `app_role` enum in
// docs/supabase-auth-schema.sql (audit §5.1).
export type AppRole = "customer" | "rider" | "kitchen" | "manager" | "admin";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until the deploy is wired to Supabase (Phase 0). Pages degrade to a setup notice. */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/**
 * Lazily-created Supabase client (PKCE flow, refresh rotation).
 * Throws a clear error when env is missing instead of failing at import time,
 * so the public marketing pages still render without configuration.
 */
export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        flowType: "pkce",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
