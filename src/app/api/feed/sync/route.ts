import { after } from "next/server";
import { getTenant, invalidateTenant } from "@/lib/tenant/resolve";
import { serviceClient } from "@/lib/supabase/service";
import { parseFeed } from "@/lib/feed/parse";
import { normalizeProduct } from "@/lib/feed/normalize";
import { invalidateCatalog } from "@/lib/catalog/providers";
import type { Product } from "@/lib/catalog/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/feed/sync   { "tenant": "<slug>" }   Authorization: Bearer <secret>

   Pulls the brand's feed, normalises it, replaces the catalog, and returns a
   REPORT — not just a count. The report is the deliverable: it names the rows
   that were rejected and why, so the brand's ERP team fixes its data instead of
   us maintaining a pile of per-brand exceptions.

   Two safety rules make this idempotent and safe to run on a cron:
   · A parse failure or an empty result NEVER clears the existing catalog. A
     brand whose feed 500s for ten minutes keeps selling.
   · A sync that would delete more than DELETION_GUARD of the catalog stops and
     reports instead. That is the shape of a truncated feed, not a sale.
   ═══════════════════════════════════════════════════════════════════════════ */

const DELETION_GUARD = 0.4;
const FEED_TIMEOUT_MS = 60_000;
const MAX_ISSUES_REPORTED = 50;

export interface SyncReport {
  tenant: string;
  ok: boolean;
  fetched: number;
  imported: number;
  rejected: number;
  removed: number;
  issues: string[];
  truncatedIssues: number;
  durationMs: number;
  message?: string;
}

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  const secret = process.env.FEED_SYNC_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { tenant?: string };
  const slug = typeof body.tenant === "string" ? body.tenant : "";
  const tenant = await getTenant(slug);
  if (!tenant) return Response.json({ error: "unknown_tenant" }, { status: 404 });
  if (!tenant.feed.url) {
    return Response.json({ error: "no_feed_url_configured" }, { status: 400 });
  }

  const fail = (message: string, extra: Partial<SyncReport> = {}) =>
    Response.json(
      {
        tenant: slug, ok: false, fetched: 0, imported: 0, rejected: 0, removed: 0,
        issues: [], truncatedIssues: 0, durationMs: Date.now() - startedAt,
        message, ...extra,
      } satisfies SyncReport,
      { status: 200 }, // a report, not a transport failure — cron should not retry-storm
    );

  // ── fetch ────────────────────────────────────────────────────────────────
  let raw: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    const res = await fetch(tenant.feed.url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return fail(`Feed adresi ${res.status} döndü. Katalog değiştirilmedi.`);
    raw = await res.text();
  } catch (e) {
    return fail(
      `Feed indirilemedi (${e instanceof Error ? e.message : "bilinmeyen hata"}). Katalog değiştirilmedi.`,
    );
  }

  // ── parse + normalise ────────────────────────────────────────────────────
  const parsed = parseFeed(raw, tenant.feed);
  if (parsed.error) return fail(parsed.error);

  const products: Product[] = [];
  const issues: string[] = [];
  let rejected = 0;
  const seenSkus = new Set<string>();

  for (const node of parsed.items) {
    const result = normalizeProduct(node, tenant.feed);
    if (result.rejected || !result.product) {
      rejected++;
      issues.push(...result.issues);
      continue;
    }
    // A duplicate sku means the feed carries per-variant rows the itemPath is
    // reading as products. Keep the first and say so — silently overwriting
    // would produce a catalog with one size per product.
    if (seenSkus.has(result.product.sku)) {
      issues.push(`Tekrarlanan sku atlandı: ${result.product.sku} (feed satır bazlı olabilir)`);
      continue;
    }
    seenSkus.add(result.product.sku);
    products.push(result.product);
    issues.push(...result.issues);
  }

  if (!products.length) {
    return fail(
      `Feed'de ${parsed.items.length} satır bulundu ama hiçbiri içe aktarılamadı. ` +
        `Katalog değiştirilmedi.`,
      { fetched: parsed.items.length, rejected, issues: issues.slice(0, MAX_ISSUES_REPORTED) },
    );
  }

  const supabase = serviceClient();
  if (!supabase) {
    return fail("Veritabanı yapılandırılmamış (SUPABASE_SERVICE_ROLE_KEY yok).", {
      fetched: parsed.items.length,
      rejected,
    });
  }

  // ── deletion guard ───────────────────────────────────────────────────────
  const { count: existing } = await supabase
    .from("tenant_products")
    .select("sku", { count: "exact", head: true })
    .eq("tenant_slug", slug)
    .eq("active", true);

  const previous = existing ?? 0;
  if (previous > 0) {
    const wouldRemove = previous - products.length;
    if (wouldRemove > 0 && wouldRemove / previous > DELETION_GUARD) {
      return fail(
        `Güvenlik durdurması: feed ${products.length} ürün içeriyor, mevcut katalogda ${previous} ürün var. ` +
          `Katalogun %${Math.round((wouldRemove / previous) * 100)}'i silinecekti — feed eksik gelmiş olabilir. ` +
          `Katalog değiştirilmedi.`,
        { fetched: parsed.items.length, rejected, issues: issues.slice(0, MAX_ISSUES_REPORTED) },
      );
    }
  }

  // ── replace ──────────────────────────────────────────────────────────────
  const rows = products.map((p) => ({
    tenant_slug: slug,
    sku: p.sku,
    name: p.name,
    name_en: p.nameEn ?? null,
    department: p.department,
    category: p.category,
    garment_type: p.garmentType,
    color: p.color ?? null,
    color_family: p.colorFamily ?? null,
    composition: p.composition ?? null,
    fabrics: p.fabrics,
    seasons: p.seasons,
    price_minor: p.priceMinor,
    currency: p.currency,
    price_display: p.priceDisplay,
    size_system: p.sizeSystem ?? null,
    variants: p.variants,
    image_main: p.imageMain,
    image_detail: p.imageDetail ?? null,
    image_model: p.imageModel ?? null,
    product_url: p.productUrl,
    description: p.description ?? null,
    care: p.care ?? null,
    related_skus: p.relatedSkus,
    active: true,
    synced_at: new Date().toISOString(),
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("tenant_products")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "tenant_slug,sku" });
    if (error) {
      return fail(`Katalog yazılamadı: ${error.message}. Mevcut katalog korundu.`, {
        fetched: parsed.items.length,
        rejected,
      });
    }
  }

  // Anything not in this feed is retired rather than deleted, so a sku that
  // reappears next week keeps its history and a mistake stays reversible.
  const { data: retired } = await supabase
    .from("tenant_products")
    .update({ active: false })
    .eq("tenant_slug", slug)
    .eq("active", true)
    .not("sku", "in", `(${[...seenSkus].map((s) => `"${s.replace(/"/g, '""')}"`).join(",")})`)
    .select("sku");

  invalidateCatalog(slug);
  invalidateTenant(slug);

  const report: SyncReport = {
    tenant: slug,
    ok: true,
    fetched: parsed.items.length,
    imported: products.length,
    rejected,
    removed: retired?.length ?? 0,
    issues: issues.slice(0, MAX_ISSUES_REPORTED),
    truncatedIssues: Math.max(0, issues.length - MAX_ISSUES_REPORTED),
    durationMs: Date.now() - startedAt,
  };

  after(async () => {
    await supabase.from("feed_runs").insert({
      tenant_slug: slug,
      ok: true,
      fetched: report.fetched,
      imported: report.imported,
      rejected: report.rejected,
      removed: report.removed,
      issues: report.issues,
      duration_ms: report.durationMs,
    });
  });

  return Response.json(report);
}
