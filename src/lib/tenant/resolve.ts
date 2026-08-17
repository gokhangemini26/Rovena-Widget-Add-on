import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { serviceClient } from "@/lib/supabase/service";
import type { Tenant } from "./types";

/* ═══════════════════════════════════════════════════════════════════════════
   Tenant resolution.

   Production reads the `tenants` table. Local development can read
   ./tenants/<slug>.json instead (ROVENA_LOCAL_TENANTS=1) so the whole widget —
   chat, catalog, embed — can be demoed to a brand from a laptop with no
   database at all. The shapes are identical, so nothing downstream branches.

   Resolved tenants are cached in-process for CACHE_TTL_MS. Config changes are
   rare and a per-request round-trip on every widget message is real latency in
   front of a customer. `invalidateTenant` clears one entry after a config write.
   ═══════════════════════════════════════════════════════════════════════════ */

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; tenant: Tenant | null }>();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** Slugs come from a URL path and are used to build a filesystem path in local
    mode, so they are validated rather than trusted. */
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

async function readLocalTenant(slug: string): Promise<Tenant | null> {
  try {
    const file = path.join(process.cwd(), "tenants", `${slug}.json`);
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as Tenant;
  } catch {
    return null;
  }
}

async function readDbTenant(slug: string): Promise<Tenant | null> {
  const supabase = serviceClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("tenants")
    .select("slug, name, status, allowed_origins, config")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;

  // `config` holds everything the columns don't, so adding a tenant-level knob
  // is a JSON change rather than a migration.
  const cfg = (data.config ?? {}) as Omit<
    Tenant,
    "slug" | "name" | "status" | "allowedOrigins"
  >;
  return {
    ...cfg,
    slug: data.slug,
    name: data.name,
    status: data.status,
    allowedOrigins: data.allowed_origins ?? [],
  } as Tenant;
}

export async function getTenant(slug: string): Promise<Tenant | null> {
  if (!isValidSlug(slug)) return null;

  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.tenant;

  const tenant =
    process.env.ROVENA_LOCAL_TENANTS === "1"
      ? await readLocalTenant(slug)
      : (await readDbTenant(slug)) ?? (await readLocalTenant(slug));

  cache.set(slug, { at: Date.now(), tenant });
  return tenant;
}

/** Resolve a tenant that is allowed to serve traffic right now. */
export async function getActiveTenant(slug: string): Promise<Tenant | null> {
  const t = await getTenant(slug);
  if (!t) return null;
  return t.status === "paused" ? null : t;
}

export async function listAllTenants(): Promise<Tenant[]> {
  const list: Tenant[] = [];
  const seen = new Set<string>();

  // Try DB first if available
  const supabase = serviceClient();
  if (supabase && process.env.ROVENA_LOCAL_TENANTS !== "1") {
    const { data } = await supabase
      .from("tenants")
      .select("slug, name, status, allowed_origins, config")
      .order("name", { ascending: true });
    if (data) {
      for (const row of data) {
        const cfg = (row.config ?? {}) as Omit<
          Tenant,
          "slug" | "name" | "status" | "allowedOrigins"
        >;
        list.push({
          ...cfg,
          slug: row.slug,
          name: row.name,
          status: row.status,
          allowedOrigins: row.allowed_origins ?? [],
        } as Tenant);
        seen.add(row.slug);
      }
    }
  }

  // Also read local files in tenants/ directory
  try {
    const dir = path.join(process.cwd(), "tenants");
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (f.endsWith(".json") && !f.endsWith(".products.json")) {
        const slug = f.replace(".json", "");
        if (!seen.has(slug)) {
          const tenant = await readLocalTenant(slug);
          if (tenant) {
            list.push(tenant);
            seen.add(slug);
          }
        }
      }
    }
  } catch {
    // Ignore error if directory doesn't exist
  }

  return list;
}

export async function saveTenant(tenant: Tenant): Promise<{ ok: boolean; error?: string }> {
  if (!isValidSlug(tenant.slug)) {
    return { ok: false, error: "Geçersiz slug formatı (sadece küçük harf, rakam ve tire)" };
  }

  // 1. Save to local JSON file
  try {
    const dir = path.join(process.cwd(), "tenants");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${tenant.slug}.json`);
    await fs.writeFile(file, JSON.stringify(tenant, null, 2), "utf8");
  } catch (err) {
    console.error("Local tenant write error:", err);
  }

  // 2. Save to Supabase if configured
  const supabase = serviceClient();
  if (supabase) {
    const { slug, name, status, allowedOrigins, ...config } = tenant;
    const { error } = await supabase.from("tenants").upsert({
      slug,
      name,
      status: status || "active",
      allowed_origins: allowedOrigins || [],
      config,
      updated_at: new Date().toISOString(),
    }, { onConflict: "slug" });

    if (error) {
      console.warn("Supabase tenant upsert error (fallback to local):", error.message);
    }
  }

  invalidateTenant(tenant.slug);
  return { ok: true };
}

export function invalidateTenant(slug: string): void {
  cache.delete(slug);
}
