import "server-only";
import type { Product } from "@/lib/catalog/types";
import type { Tenant } from "@/lib/tenant/types";

/* ═══════════════════════════════════════════════════════════════════════════
   The stock contract.

   Availability is NEVER a product field the model can read, never part of the
   catalog projection, never in the system prompt. The only way stock enters a
   conversation is as the return value of this provider, surfaced through the
   `checkStock` tool. That is a data rule, not a prompt rule — which is the
   difference between "we asked the model not to" and "the model cannot".

   `unknown` is never treated as available. A provider that times out produces
   "kontrol edip döneyim", not a sale the brand cannot fulfil.
   ═══════════════════════════════════════════════════════════════════════════ */

export type StockStatus =
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "assumed"
  | "unknown";

export interface StockRecord {
  sku: string;
  size: string;
  status: StockStatus;
  quantity: number | null;
  source: "assumed" | "feed" | "endpoint";
  checkedAt: string;
}

export interface InventoryProvider {
  readonly mode: Tenant["inventory"]["mode"];
  check(product: Product, sizes: string[]): Promise<StockRecord[]>;
}

const ENDPOINT_TIMEOUT_MS = 2_500;

/** No stock system at all. Says "the catalog lists it", never "it is in stock" —
    the wording difference is carried by the status, and the prompt is told to
    keep them apart. */
class AssumedInventoryProvider implements InventoryProvider {
  readonly mode = "assumed" as const;
  async check(product: Product, sizes: string[]): Promise<StockRecord[]> {
    const known = new Set(product.variants.map((v) => v.size));
    const at = new Date().toISOString();
    return sizes.map((size) => ({
      sku: product.sku,
      size,
      status: known.has(size) ? ("assumed" as const) : ("out_of_stock" as const),
      quantity: null,
      source: "assumed" as const,
      checkedAt: at,
    }));
  }
}

/** Stock came in the feed. As fresh as the last sync — honest, but a size that
    sold out an hour ago still reads as available, so the threshold matters. */
class FeedInventoryProvider implements InventoryProvider {
  readonly mode = "feed" as const;
  constructor(private readonly lowStockThreshold: number) {}

  async check(product: Product, sizes: string[]): Promise<StockRecord[]> {
    const at = new Date().toISOString();
    return sizes.map((size) => {
      const variant = product.variants.find((v) => v.size === size);
      if (!variant) {
        return { sku: product.sku, size, status: "out_of_stock" as const, quantity: 0, source: "feed" as const, checkedAt: at };
      }
      if (variant.stock === null) {
        return { sku: product.sku, size, status: "unknown" as const, quantity: null, source: "feed" as const, checkedAt: at };
      }
      const status: StockStatus =
        variant.stock <= 0 ? "out_of_stock"
        : variant.stock <= this.lowStockThreshold ? "low_stock"
        : "in_stock";
      return { sku: product.sku, size, status, quantity: variant.stock, source: "feed" as const, checkedAt: at };
    });
  }
}

/** Live call to the brand's own stock service. */
class EndpointInventoryProvider implements InventoryProvider {
  readonly mode = "endpoint" as const;
  constructor(
    private readonly url: string,
    private readonly lowStockThreshold: number,
    private readonly authHeader?: string,
    private readonly authValue?: string,
  ) {}

  async check(product: Product, sizes: string[]): Promise<StockRecord[]> {
    const at = new Date().toISOString();
    const unknown = (size: string): StockRecord => ({
      sku: product.sku, size, status: "unknown", quantity: null, source: "endpoint", checkedAt: at,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);
    try {
      const url = new URL(this.url);
      url.searchParams.set("sku", product.sku);
      url.searchParams.set("sizes", sizes.join(","));
      const headers: Record<string, string> = { accept: "application/json" };
      if (this.authHeader && this.authValue) headers[this.authHeader] = this.authValue;

      const res = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
      if (!res.ok) return sizes.map(unknown);

      // Accept both { items: [...] } and a bare array — brands ship both, and
      // failing on the shape would mean "out of stock" to the customer.
      const body = (await res.json()) as unknown;
      const rows = Array.isArray(body)
        ? body
        : Array.isArray((body as { items?: unknown }).items)
          ? ((body as { items: unknown[] }).items)
          : [];

      const bySize = new Map<string, number | null>();
      for (const r of rows as Record<string, unknown>[]) {
        const size = String(r.size ?? r.beden ?? "").trim();
        if (!size) continue;
        const qtyRaw = r.quantity ?? r.qty ?? r.stok ?? r.stock;
        const qty = Number(qtyRaw);
        const available = r.available ?? r.mevcut;
        bySize.set(
          size,
          Number.isFinite(qty) ? qty : available === true ? 1 : available === false ? 0 : null,
        );
      }

      return sizes.map((size) => {
        if (!bySize.has(size)) return unknown(size);
        const qty = bySize.get(size)!;
        if (qty === null) return unknown(size);
        const status: StockStatus =
          qty <= 0 ? "out_of_stock"
          : qty <= this.lowStockThreshold ? "low_stock"
          : "in_stock";
        return { sku: product.sku, size, status, quantity: qty, source: "endpoint" as const, checkedAt: at };
      });
    } catch {
      return sizes.map(unknown);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getInventory(tenant: Tenant): InventoryProvider {
  const inv = tenant.inventory;
  const threshold = inv.lowStockThreshold ?? 3;

  if (inv.mode === "endpoint" && inv.endpointUrl) {
    // The credential is read from the environment by name. Storing it on the
    // tenant row would put a brand's ERP token in a table we hand to a
    // dashboard query one day.
    const value = inv.endpointAuthEnvVar ? process.env[inv.endpointAuthEnvVar] : undefined;
    return new EndpointInventoryProvider(inv.endpointUrl, threshold, inv.endpointAuthHeader, value);
  }
  if (inv.mode === "feed") return new FeedInventoryProvider(threshold);
  return new AssumedInventoryProvider();
}

/** The sentence the model is allowed to say for each status. Centralised so a
    prompt edit can never invent a stronger claim than the data supports. */
export function stockPhrasing(record: StockRecord): string {
  switch (record.status) {
    case "in_stock": return `${record.size} bedeni mağaza sisteminde mevcut.`;
    case "low_stock": return `${record.size} bedeninden sınırlı sayıda kalmış.`;
    case "out_of_stock": return `${record.size} bedeni şu an mevcut değil.`;
    case "assumed": return `${record.size} bedeni koleksiyonda listeli; stok teyidini mağazadan almak gerekiyor.`;
    case "unknown": return `${record.size} bedeni için stok bilgisi şu an alınamadı, teyit edip dönmek gerekiyor.`;
  }
}
