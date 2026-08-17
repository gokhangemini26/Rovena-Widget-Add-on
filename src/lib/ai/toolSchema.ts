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

/* ── page control + try-on ─────────────────────────────────────────────────
   Tenant-DEPENDENT, so these are built per request rather than declared as a
   constant: the sections and categories a stylist may target are whatever the
   brand listed, injected as an enum. A model cannot scroll to a section that
   does not exist on the brand's page if the schema won't let it name one —
   same discipline as naming products only by sku.

   All of these are UI tools. The widget cannot touch the host page itself; it
   asks the loader, which acts on the brand's side. */
export function buildPageTools(tenant: {
  pageControl?: { enabled: boolean; sections: { id: string; label: string }[]; categories: { id: string; label: string; url: string }[]; cart: boolean };
  tryOn?: { enabled: boolean };
}): FunctionDeclaration[] {
  const out: FunctionDeclaration[] = [];
  const pc = tenant.pageControl;

  if (pc?.enabled) {
    if (pc.sections?.length) {
      out.push({
        name: "scrollToSection",
        description:
          "Müşteriyi sitenin belirli bir bölümüne kaydırır. " +
          "Bölümler: " +
          pc.sections.map((s) => `${s.id} (${s.label})`).join(", ") +
          ". Müşteri 'göster', 'oraya git', 'nerede' dediğinde kullan.",
        parameters: {
          type: Type.OBJECT,
          properties: { section: { type: Type.STRING, enum: pc.sections.map((s) => s.id) } },
          required: ["section"],
        },
      });
    }
    if (pc.categories?.length) {
      out.push({
        name: "openCategory",
        description:
          "Müşteriyi bir kategori sayfasına götürür. " +
          "Kategoriler: " +
          pc.categories.map((c) => `${c.id} (${c.label})`).join(", ") +
          ". Sayfa değiştiği için sohbet kapanabilir; yalnızca müşteri açıkça istediğinde kullan.",
        parameters: {
          type: Type.OBJECT,
          properties: { category: { type: Type.STRING, enum: pc.categories.map((c) => c.id) } },
          required: ["category"],
        },
      });
    }
    out.push({
      name: "showProduct",
      description:
        "Sayfada o ürüne kaydırır ve vurgular — müşteri parçayı sitenin kendi " +
        "içinde görmek istediğinde. Ürün kartı göstermek için showProducts kullan.",
      parameters: {
        type: Type.OBJECT,
        properties: { sku: { type: Type.STRING } },
        required: ["sku"],
      },
    });
    if (pc.cart) {
      out.push({
        name: "openCart",
        description:
          "Sepeti açar. Müşteri 'sepetimde ne var', 'sepeti göster', 'ödemeye geçelim' dediğinde çağır.",
        parameters: { type: Type.OBJECT, properties: {} },
      });
      out.push({
        name: "closeCart",
        description: "Sepeti kapatır. Konu sepetten başka bir şeye döndüğünde çağır.",
        parameters: { type: Type.OBJECT, properties: {} },
      });
    }
  }

  if (tenant.tryOn?.enabled) {
    out.push({
      name: "showOnModel",
      description:
        "Ekranda gösterdiğin kombini bir manken üzerinde giydirip görselini üretir. " +
        "SADECE müşteri istediğinde ('mankende görelim', 'üzerinde nasıl durur', " +
        "'giydir') veya teklifine 'evet' dediğinde çağır. Kendi sorunla aynı " +
        "cümlede çağırma. Önce showProducts ile kombini ekrana koy — panelde ne " +
        "varsa o giydirilir. Görsel yaklaşık 20 saniyede gelir; beklerken ikinci " +
        "kez çağırma ve müşteriye 'bir tuşa basın' deme.",
      parameters: { type: Type.OBJECT, properties: {} },
    });
  }

  return out;
}

/** Every tool declaration for a tenant: the fixed catalog surface plus
    whatever page control and try-on that brand switched on. */
export function buildToolDeclarations(tenant: Parameters<typeof buildPageTools>[0]): FunctionDeclaration[] {
  return [...TOOL_DECLARATIONS, ...buildPageTools(tenant)];
}

export const READ_TOOLS = new Set(["searchProducts", "getProducts", "checkStock"]);
export const UI_TOOLS = new Set([
  "showProducts",
  "addToCart",
  "scrollToSection",
  "openCategory",
  "showProduct",
  "openCart",
  "closeCart",
  "showOnModel",
]);
/** UI tools the host page carries out (as opposed to ones the widget renders
    itself). Used by the widget to decide what to postMessage. */
export const PAGE_TOOLS = new Set([
  "scrollToSection",
  "openCategory",
  "showProduct",
  "openCart",
  "closeCart",
]);
