import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* Service-role client. Used for the three jobs that legitimately cross tenant
   boundaries or bypass RLS: feed ingestion, usage metering, and tenant
   resolution. Never reachable from a route that echoes rows back to a browser
   without an explicit tenant filter — every query in this repo that uses it
   carries `.eq("tenant_id", ...)`. */

let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/** True when a database is configured at all. Local-tenant mode runs without
    one, and every caller degrades instead of throwing. */
export function hasDatabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
