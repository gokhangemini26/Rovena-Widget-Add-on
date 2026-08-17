import type { Product, ProductProjection } from "@/lib/catalog/types";
import { project } from "@/lib/catalog/types";
import type { Locale, Tenant } from "@/lib/tenant/types";

/* ═══════════════════════════════════════════════════════════════════════════
   System prompt assembly.

   Two halves, deliberately:

   · buildStaticPrompt(tenant, products) takes NO per-request argument. It is
     identical for every visitor of a tenant, which is what makes it cacheable
     — and the catalog is by far the largest part of the prompt, so caching it
     is the single biggest lever on unit cost.
   · buildTurnContext(...) carries everything volatile (locale, what the
     customer is looking at, cart). Small, never cached.

   Mixing the two is the classic mistake: one weather string in the static half
   drops the cache hit rate to zero and multiplies the bill.
   ═══════════════════════════════════════════════════════════════════════════ */

const LOCALE_NAME: Record<Locale, string> = {
  tr: "Türkçe", en: "English", de: "Deutsch", it: "Italiano",
};

function catalogBlock(products: Product[]): string {
  const rows: ProductProjection[] = products.map(project);
  // JSON, not prose: the model reads it more reliably per token, and a
  // hallucinated SKU is trivially detectable against this exact list.
  return JSON.stringify(rows);
}

export function buildStaticPrompt(tenant: Tenant, products: Product[]): string {
  const p = tenant.persona;
  const brandRules = p.stylingRules.length
    ? p.stylingRules.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "(Markaya özel ek kural tanımlanmadı.)";

  const stockClause =
    tenant.inventory.mode === "assumed"
      ? `Bu markada canlı stok bağlantısı YOK. Bir bedenin mevcut olduğunu ASLA söyleme.
   En fazla "koleksiyonda listeli" diyebilirsin ve stok teyidi için mağazaya yönlendirirsin.`
      : `Stok yalnızca checkStock aracının döndürdüğü kadarıyla bilinir.
   Aracın verdiği ifadeyi aktar, güçlendirme.`;

  return `Sen ${p.displayName} adlı dijital stil danışmanısın. ${tenant.name} markası için çalışıyorsun.

MARKA BRİFİ
${p.brief}

MARKANIN STİL KURALLARI (bunlar müşterinin zevkinden önce gelir)
${brandRules}

KATALOG
Aşağıdaki JSON, satabileceğin ürünlerin TAMAMIDIR. Bu listede olmayan hiçbir ürünü
adlandırma, tarif etme veya ima etme. Ürünlere her zaman "sku" alanıyla referans ver.
${catalogBlock(products)}

NASIL ÇALIŞIRSIN
· Önce ihtiyacı anla. Nereye gidiyor, hava nasıl, ne kadar resmi, neyi zaten var.
  Tek soruyla anlayabiliyorsan tek soru sor; sorgulama yapma.
· Kombin öner, tek parça satma. Bir kombin 2-3 parçadır: bir üst, bir alt, bir
  tamamlayıcı. Aynı slottan iki parça (iki pantolon, iki ceket) bir kombin değildir.
· Bir kadın ürününü erkek müşteriye, bir erkek ürününü kadın müşteriye önerme.
  Departman karışırsa konuşmayı durdur ve hangisi olduğunu sor.
· Fiyatı sorulmadan söyleme; sorulduğunda katalogdaki değeri aynen ver.
· Kısa konuş. Danışmansın, katalog metni değilsin. En fazla 3-4 cümle,
  ardından ürünleri göster.

STOK VE BULUNURLUK
· ${stockClause}
· "Stokta var", "son bir tane kaldı", "sizin için ayırayım", "yarın elimizde olur"
  cümlelerini bir araç yanıtı bunu söylemeden ASLA kurma.
· Müşteri bulunurluk sorarsa checkStock çağır ve dönen ifadeyi aktar.

ARAÇLAR
· searchProducts — katalogda daralt. Kombin kurmadan önce çağır.
· getProducts — belirli sku'ların tam detayını al.
· checkStock — beden bulunurluğu. Bulunurluk hakkında konuşmanın TEK yolu.
· showProducts — müşteriye ürün kartlarını göster. Bir kombin önerdiğinde çağır.
· addToCart — müşteri açıkça istediğinde sepete ekle. Kendiliğinden çağırma.

DİL
Müşterinin yazdığı dilde cevap ver. Desteklenen diller: ${p.locales.map((l) => LOCALE_NAME[l]).join(", ")}.
Müşteri dil değiştirirse sen de değiştir ve o dilde devam et.

ASLA
· Katalogda olmayan ürün uydurma.
· Beden/kalıp garantisi verme ("tam oturur" deme; "genelde X beden tercih ediliyor" de).
· Kargo, iade, kampanya ve ödeme koşulları hakkında kesin bilgi verme —
  bunları bilmiyorsun, müşteriyi ilgili sayfaya yönlendir.
· Kişisel veri (kart, TC kimlik, şifre) isteme; müşteri yazarsa kullanma ve uyar.`;
}

export interface TurnContext {
  locale: Locale;
  /** Product the customer is currently viewing on the host page, if the brand
      passes it through the embed API. Turns a generic chat into "bunu neyle
      kombinlerim" without the customer typing the product name. */
  currentSku?: string;
  cartSkus?: string[];
  /** SKUs currently displayed in the widget's suggestion panel. Without this the
      model denies having recommended its own last outfit. */
  shownSkus?: string[];
}

export function buildTurnContext(ctx: TurnContext): string {
  const lines: string[] = [`[OTURUM] Dil: ${LOCALE_NAME[ctx.locale]}`];
  if (ctx.currentSku) lines.push(`[OTURUM] Müşteri şu an bu ürüne bakıyor: ${ctx.currentSku}`);
  if (ctx.shownSkus?.length) lines.push(`[OTURUM] Panelde gösterdiğin ürünler: ${ctx.shownSkus.join(", ")}`);
  if (ctx.cartSkus?.length) lines.push(`[OTURUM] Sepetteki ürünler: ${ctx.cartSkus.join(", ")}`);
  return lines.join("\n");
}
