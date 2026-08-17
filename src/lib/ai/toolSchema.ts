import { Type, type FunctionDeclaration } from "@google/genai";

/* Client-safe tool schema — no "server-only", so both the text chat route
   (server) and the Live voice client (browser) declare the SAME tool surface
   to the model. Tool names and product slugs are already public; nothing here
   is sensitive. Execution (catalog/inventory access) stays in tools.ts. */

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
