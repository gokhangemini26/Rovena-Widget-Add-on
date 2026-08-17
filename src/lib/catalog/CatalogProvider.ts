import type { Department, GarmentType, Product } from "./types";

/* The seam the source product proved out: consumers above this interface never
   learn where the catalog came from. Here it is tenant-scoped, because a
   provider that could return another brand's products is the one bug in a
   multi-tenant add-on nobody forgives. */

export interface CatalogQuery {
  department?: Department;
  garmentTypes?: GarmentType[];
  colorFamilies?: string[];
  /** Free text matched against name, category and colour. */
  text?: string;
  maxPriceMinor?: number;
  minPriceMinor?: number;
  season?: string;
  limit?: number;
}

export interface CatalogProvider {
  readonly tenantSlug: string;
  readonly source: "supabase" | "memory";
  getAll(): Promise<Product[]>;
  getBySku(sku: string): Promise<Product | null>;
  getManyBySku(skus: string[]): Promise<Product[]>;
  search(query: CatalogQuery): Promise<Product[]>;
  count(): Promise<number>;
}

/** Deterministic filter shared by every provider so "search" means the same
    thing whether it ran in Postgres or over an in-memory array. Ranking is
    deliberately absent: the model does the styling judgement, the catalog only
    narrows honestly. */
export function applyQuery(products: Product[], q: CatalogQuery): Product[] {
  const text = q.text?.trim().toLowerCase();
  const out = products.filter((p) => {
    if (q.department && p.department !== q.department && p.department !== "unisex") {
      return false;
    }
    if (q.garmentTypes?.length && !q.garmentTypes.includes(p.garmentType)) return false;
    if (q.colorFamilies?.length) {
      if (!p.colorFamily || !q.colorFamilies.includes(p.colorFamily)) return false;
    }
    if (q.maxPriceMinor !== undefined && p.priceMinor > q.maxPriceMinor) return false;
    if (q.minPriceMinor !== undefined && p.priceMinor < q.minPriceMinor) return false;
    if (q.season && p.seasons.length && !p.seasons.includes(q.season as never)) return false;
    if (text) {
      const haystack = `${p.name} ${p.category} ${p.color ?? ""} ${p.composition ?? ""}`.toLowerCase();
      if (!text.split(/\s+/).every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
  return q.limit ? out.slice(0, q.limit) : out;
}
