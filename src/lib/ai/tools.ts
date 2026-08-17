import "server-only";
import { Type, type FunctionDeclaration } from "@google/genai";
import type { CatalogProvider } from "@/lib/catalog";
import { project } from "@/lib/catalog/types";
import { getInventory, stockPhrasing } from "@/lib/inventory/InventoryProvider";
import type { Tenant } from "@/lib/tenant/types";

/* Tool surface. Read tools resolve server-side and loop back into the model;
   showProducts and addToCart are UI intents streamed to the widget instead.

   Every tool that names a product takes a sku and is resolved against the
   tenant's own catalog, so a hallucinated sku returns a miss the model must
   recover from rather than a product card the customer sees. */

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "searchProducts",
    description:
      "Katalogda arama yapar. Kombin kurmadan veya ürün önermeden önce çağrılır. " +
      "Sonuç boşsa daha geniş kriterle tekrar dene.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        department: { type: Type.STRING, enum: ["women", "men", "unisex"] },
        garmentTypes: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: ["outerwear", "top", "bottom", "dress", "suit", "shoes", "bag", "accessory"],
          },
          description: "Kombinin hangi katmanını aradığın.",
        },
        colorFamilies: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "black, white, grey, navy, blue, brown, green, red, pink, purple, yellow, orange",
        },
        text: { type: Type.STRING, description: "Serbest metin: ürün adı, kategori, kumaş." },
        maxPrice: { type: Type.NUMBER, description: "Üst fiyat sınırı, para biriminin ana birimi cinsinden." },
        season: { type: Type.STRING, enum: ["spring", "summer", "autumn", "winter"] },
      },
    },
  },
  {
    name: "getProducts",
    description: "Belirli sku'ların tam detayını getirir.",
    parameters: {
      type: Type.OBJECT,
      properties: { skus: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ["skus"],
    },
  },
  {
    name: "checkStock",
    description:
      "Beden bulunurluğunu mağaza sisteminden sorar. Bulunurluk hakkında konuşmanın TEK yolu budur. " +
      "Dönen ifadeyi aynen aktar, güçlendirme.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sku: { type: Type.STRING },
        sizes: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["sku", "sizes"],
    },
  },
  {
    name: "showProducts",
    description:
      "Ürün kartlarını müşteriye gösterir. Bir kombin önerdiğinde mutlaka çağır — " +
      "aksi halde müşteri bahsettiğin parçaları göremez.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        skus: { type: Type.ARRAY, items: { type: Type.STRING } },
        title: { type: Type.STRING, description: "Kısa başlık, ör. 'Akşam yemeği için'." },
      },
      required: ["skus"],
    },
  },
  {
    name: "addToCart",
    description: "Müşteri açıkça istediğinde sepete ekler. Kendiliğinden çağırma.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sku: { type: Type.STRING },
        size: { type: Type.STRING },
        quantity: { type: Type.NUMBER },
      },
      required: ["sku", "size"],
    },
  },
];

export const READ_TOOLS = new Set(["searchProducts", "getProducts", "checkStock"]);
export const UI_TOOLS = new Set(["showProducts", "addToCart"]);

const MAX_SEARCH_RESULTS = 12;

export interface ToolDeps {
  tenant: Tenant;
  catalog: CatalogProvider;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function executeReadTool(
  name: string,
  args: Record<string, any>,
  deps: ToolDeps,
): Promise<Record<string, unknown>> {
  const { tenant, catalog } = deps;

  if (name === "searchProducts") {
    const maxPrice = Number(args.maxPrice);
    const results = await catalog.search({
      department: args.department,
      garmentTypes: args.garmentTypes,
      colorFamilies: args.colorFamilies,
      text: args.text,
      season: args.season,
      maxPriceMinor: Number.isFinite(maxPrice) ? Math.round(maxPrice * 100) : undefined,
      limit: MAX_SEARCH_RESULTS,
    });
    return {
      count: results.length,
      products: results.map(project),
      // An empty result is the moment a model is most likely to invent a
      // product, so the tool tells it what to do instead of leaving a void.
      note: results.length
        ? undefined
        : "Bu kriterlerle ürün yok. Kriterleri gevşetip tekrar ara; ürün uydurma.",
    };
  }

  if (name === "getProducts") {
    const skus: string[] = Array.isArray(args.skus) ? args.skus.map(String) : [];
    const found = await catalog.getManyBySku(skus);
    const missing = skus.filter((s) => !found.some((p) => p.sku === s));
    return {
      products: found.map(project),
      missing,
      note: missing.length
        ? `Şu sku'lar katalogda YOK: ${missing.join(", ")}. Bunlardan bahsetme.`
        : undefined,
    };
  }

  if (name === "checkStock") {
    const sku = String(args.sku ?? "");
    const sizes: string[] = Array.isArray(args.sizes) ? args.sizes.map(String) : [];
    const product = await catalog.getBySku(sku);
    if (!product) {
      return { error: "not_found", note: `${sku} katalogda yok. Bulunurluk hakkında konuşma.` };
    }
    const records = await getInventory(tenant).check(product, sizes.length ? sizes : product.variants.map((v) => v.size));
    return {
      sku,
      results: records.map((r) => ({ size: r.size, status: r.status, say: stockPhrasing(r) })),
      note: "Yalnızca 'say' alanındaki ifadeyi kullan. Daha güçlü bir şey söyleme.",
    };
  }

  return { error: "unknown_tool" };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
