import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hasDatabase } from "@/lib/supabase/service";
import { MemoryCatalogProvider, SupabaseCatalogProvider } from "./providers";
import type { CatalogProvider } from "./CatalogProvider";
import type { Product } from "./types";
import type { Tenant } from "@/lib/tenant/types";

/* One factory, so no route ever constructs a provider itself and there is
   exactly one place where "which catalog does this tenant read" is decided. */

const localCache = new Map<string, Product[]>();

async function readLocalProducts(slug: string): Promise<Product[]> {
  const hit = localCache.get(slug);
  if (hit) return hit;
  try {
    const file = path.join(process.cwd(), "tenants", `${slug}.products.json`);
    const products = JSON.parse(await fs.readFile(file, "utf8")) as Product[];
    localCache.set(slug, products);
    return products;
  } catch {
    return [];
  }
}

export async function getCatalog(tenant: Tenant): Promise<CatalogProvider> {
  if (hasDatabase() && process.env.ROVENA_LOCAL_TENANTS !== "1") {
    return new SupabaseCatalogProvider(tenant.slug);
  }
  return new MemoryCatalogProvider(tenant.slug, await readLocalProducts(tenant.slug));
}

export { applyQuery } from "./CatalogProvider";
export type { CatalogProvider, CatalogQuery } from "./CatalogProvider";
