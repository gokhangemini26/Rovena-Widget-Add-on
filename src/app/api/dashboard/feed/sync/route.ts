import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant/resolve";
import { parseFeed } from "@/lib/feed/parse";
import { normalizeProduct } from "@/lib/feed/normalize";
import { invalidateCatalog } from "@/lib/catalog/providers";
import { serviceClient } from "@/lib/supabase/service";
import type { Product } from "@/lib/catalog/types";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const slug = body.tenant;
    if (!slug) {
      return NextResponse.json({ error: "tenant parametresi gerekli" }, { status: 400 });
    }

    const tenant = await getTenant(slug);
    if (!tenant) {
      return NextResponse.json({ error: "Tenant bulunamadı" }, { status: 404 });
    }

    if (!tenant.feed.url) {
      return NextResponse.json({ error: "Tenant için Feed URL tanımlanmamış" }, { status: 400 });
    }

    // Fetch feed
    const res = await fetch(tenant.feed.url, {
      cache: "no-store",
      headers: { "User-Agent": "Rovena-Sync-Engine/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: `Feed kaynağı ${res.status} ${res.statusText} döndürdü.`,
      });
    }

    const raw = await res.text();
    const parsed = parseFeed(raw, tenant.feed);

    if (parsed.error) {
      return NextResponse.json({ ok: false, error: parsed.error });
    }

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
      if (seenSkus.has(result.product.sku)) {
        issues.push(`Tekrarlanan sku atlandı: ${result.product.sku}`);
        continue;
      }
      seenSkus.add(result.product.sku);
      products.push(result.product);
      issues.push(...result.issues);
    }

    // 1. Save to local JSON products if local mode or fallback
    try {
      const localProductsFile = path.join(process.cwd(), "tenants", `${slug}.products.json`);
      await fs.writeFile(localProductsFile, JSON.stringify(products, null, 2), "utf8");
    } catch (e) {
      console.warn("Could not write local products file:", e);
    }

    // 2. Save to Supabase if configured
    const supabase = serviceClient();
    if (supabase) {
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
        await supabase
          .from("tenant_products")
          .upsert(rows.slice(i, i + CHUNK), { onConflict: "tenant_slug,sku" });
      }
    }

    invalidateCatalog(slug);

    return NextResponse.json({
      ok: true,
      tenant: slug,
      fetched: parsed.items.length,
      imported: products.length,
      rejected,
      issues: issues.slice(0, 30),
      durationMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Senkronizasyon hatası" },
      { status: 500 }
    );
  }
}
