import { createHash } from "crypto";
import type { UserStyleDna, UserSizes } from "./types";

/* ═══════════════════════════════════════════════════════════════════════════
   Style Memory Store (Privacy-First / In-Memory & Supabase Bridge)
   ═══════════════════════════════════════════════════════════════════════════ */

// In-memory cache for development / ROVENA_LOCAL_TENANTS mode
const localMemoryStore = new Map<string, UserStyleDna>();

/** Mask email address for safe display (e.g. "ahmet@gmail.com" -> "a***t@gmail.com") */
export function maskEmail(email: string): string {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return "kullanıcı";
  const [user, domain] = parts;
  if (user.length <= 2) return `${user[0]}*@${domain}`;
  return `${user[0]}${"*".repeat(Math.max(1, user.length - 2))}${user[user.length - 1]}@${domain}`;
}

/** Compute deterministic SHA-256 hash for tenant + email */
export function hashEmail(tenantSlug: string, email: string): string {
  const cleanEmail = email.trim().toLowerCase();
  return createHash("sha256")
    .update(`${tenantSlug}:${cleanEmail}`)
    .digest("hex");
}

/** Retrieve user style DNA if explicit consent is on file */
export async function getStyleDna(tenantSlug: string, email: string): Promise<UserStyleDna | null> {
  if (!email || !email.includes("@")) return null;
  const key = hashEmail(tenantSlug, email);

  const found = localMemoryStore.get(key);
  if (!found || !found.consentGiven) return null;
  return found;
}

/** Save or update style DNA with explicit consent */
export async function saveStyleDna(
  tenantSlug: string,
  email: string,
  dna: Partial<UserStyleDna>,
  consentGiven: boolean
): Promise<UserStyleDna> {
  const key = hashEmail(tenantSlug, email);
  const now = new Date().toISOString();
  const existing = localMemoryStore.get(key);

  const updated: UserStyleDna = {
    tenantSlug,
    emailHash: key,
    displayEmail: maskEmail(email),
    consentGiven,
    consentDate: existing?.consentDate ?? now,
    sizes: { ...existing?.sizes, ...dna.sizes },
    favoriteColors: Array.from(new Set([...(existing?.favoriteColors ?? []), ...(dna.favoriteColors ?? [])])),
    dislikedStyles: Array.from(new Set([...(existing?.dislikedStyles ?? []), ...(dna.dislikedStyles ?? [])])),
    styleNotes: Array.from(new Set([...(existing?.styleNotes ?? []), ...(dna.styleNotes ?? [])])),
    purchasedItems: dna.purchasedItems ?? existing?.purchasedItems ?? [],
    abandonedInterests: Array.from(new Set([...(existing?.abandonedInterests ?? []), ...(dna.abandonedInterests ?? [])])),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  localMemoryStore.set(key, updated);
  return updated;
}

/** Unutulma Hakkı: Permanently erase all memory for this email */
export async function clearStyleDna(tenantSlug: string, email: string): Promise<boolean> {
  const key = hashEmail(tenantSlug, email);
  return localMemoryStore.delete(key);
}
