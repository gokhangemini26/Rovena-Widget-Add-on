import "server-only";
import { serviceClient } from "@/lib/supabase/service";
import { applyQuery, type CatalogProvider, type CatalogQuery } from "./CatalogProvider";
import type { Product } from "./types";

/* ═══════════════════════════════════════════════════════════════════════════
   Two implementations of the same contract.

   SupabaseCatalogProvider is production. MemoryCatalogProvider backs the
   local-tenant demo mode, so the widget can be shown to a brand from a laptop
   with no database — the path that actually gets used in a sales meeting.

   Both cache the tenant's catalog in-process. A catalog changes when a feed
   syncs, not between two messages of one conversation, and re-reading a few
   thousand rows per turn is latency the customer feels.
   ═══════════════════════════════════════════════════════════════════════════ */

const CACHE_TTL_MS = 5 * 60_000;
const catalogCache = new Map<string, { at: number; products: Product[] }>();

export function invalidateCatalog(tenantSlug: string): void {
  catalogCache.delete(tenantSlug);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToProduct(r: any): Product {
  return {
    sku: r.sku,
    name: r.name,
    nameEn: r.name_en ?? undefined,
    department: r.department,
    category: r.category ?? "",
    garmentType: r.garment_type ?? "unknown",
    color: r.color ?? undefined,
    colorFamily: r.color_family ?? undefined,
    composition: r.composition ?? undefined,
    fabrics: r.fabrics ?? [],
    seasons: r.seasons ?? [],
    priceMinor: r.price_minor,
    currency: r.currency,
    priceDisplay: r.price_display,
    sizeSystem: r.size_system ?? undefined,
    variants: r.variants ?? [],
    imageMain: r.image_main,
    imageDetail: r.image_detail ?? undefined,
    imageModel: r.image_model ?? undefined,
    productUrl: r.product_url,
    description: r.description ?? undefined,
    care: r.care ?? undefined,
    relatedSkus: r.related_skus ?? [],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class SupabaseCatalogProvider implements CatalogProvider {
  readonly source = "supabase" as const;
  constructor(readonly tenantSlug: string) {}

  async getAll(): Promise<Product[]> {
    const hit = catalogCache.get(this.tenantSlug);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.products;

    const supabase = serviceClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("tenant_products")
      .select("*")
      .eq("tenant_slug", this.tenantSlug)
      .eq("active", true);
    if (error || !data) return [];

    const products = data.map(rowToProduct);
    catalogCache.set(this.tenantSlug, { at: Date.now(), products });
    return products;
  }

  async getBySku(sku: string): Promise<Product | null> {
    const all = await this.getAll();
    return all.find((p) => p.sku === sku) ?? null;
  }

  async getManyBySku(skus: string[]): Promise<Product[]> {
    const wanted = new Set(skus);
    return (await this.getAll()).filter((p) => wanted.has(p.sku));
  }

  async search(query: CatalogQuery): Promise<Product[]> {
    return applyQuery(await this.getAll(), query);
  }

  async count(): Promise<number> {
    return (await this.getAll()).length;
  }
}

export class MemoryCatalogProvider implements CatalogProvider {
  readonly source = "memory" as const;
  constructor(readonly tenantSlug: string, private readonly products: Product[]) {}

  async getAll() { return this.products; }
  async getBySku(sku: string) { return this.products.find((p) => p.sku === sku) ?? null; }
  async getManyBySku(skus: string[]) {
    const wanted = new Set(skus);
    return this.products.filter((p) => wanted.has(p.sku));
  }
  async search(query: CatalogQuery) { return applyQuery(this.products, query); }
  async count() { return this.products.length; }
}
