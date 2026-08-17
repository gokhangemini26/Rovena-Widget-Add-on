# Embed API

Markanın web ekibine. Kurulum tek satırdır; geri kalanı isteğe bağlı derinleştirme.

---

## 1. Kurulum

Sitenin şablonuna, `</body>` öncesine:

```html
<script src="https://widget.rovena.ai/rovena.js" data-tenant="MARKA-KODU" defer></script>
```

SDK kurulumu, paket bağımlılığı, build adımı veya sepet mimarisinde değişiklik
gerekmez. Script tek dosyadır, bağımlılığı yoktur ve derlenmez.

### Script parametreleri

| Öznitelik | Varsayılan | Açıklama |
|---|---|---|
| `data-tenant` | — | **Zorunlu.** Marka kodu. |
| `data-mode` | `launcher` | `launcher` (köşede balon) veya `inline` (sayfaya gömülü) |
| `data-mount` | — | `inline` modda widget'ın yerleşeceği CSS seçicisi |
| `data-open` | `false` | Sayfa açılışında danışmanı açık başlat |
| `data-origin` | script'in adresi | Widget sunucusu (normalde ayarlanmaz) |

### Üç sunum biçimi

```html
<!-- 1 · Köşede danışman balonu — tüm sayfalarda -->
<script src="…/rovena.js" data-tenant="MARKA" defer></script>

<!-- 2 · Ayrı bir stil sayfası — /stil-danismani gibi -->
<div id="stylist"></div>
<script src="…/rovena.js" data-tenant="MARKA" data-mode="inline" data-mount="#stylist" defer></script>
```

Ürün sayfası içi kullanım için Bölüm 3'e bakın.

---

## 2. Güvenlik sınırı

Widget bir iframe içinde çalışır. Bu bilinçli bir mimari karardır:

- Rovena sitenizin DOM'unu, çerezlerini, oturumunu ve ödeme akışını **göremez**.
- Rovena'nın CSS'i sitenizi, sitenizin CSS'i Rovena'yı **bozamaz**.
- iframe `allow-top-navigation` almaz: widget müşterinizi sitenizden **çıkaramaz**.

İki taraf birbirinin JavaScript'ine güvenmek zorunda değildir. Bir güvenlik
incelemesinde bakılacak yüzey, tek bir `<script>` etiketi ve bir iframe'dir.

### İzinli alan adları

Widget yalnızca önceden bildirilen alan adlarında çalışır. Tam eşleme yapılır
(şema + host + port), joker karakter yoktur. Listede olmayan bir alan adı
403 alır ve konsola sebebi yazılır.

Test/staging alan adlarınızı da bildirin.

---

## 3. Sepet köprüsü

Üç mod vardır. Marka konfigürasyonunda seçilir.

### `redirect` — sizin tarafınızda iş yok
Müşteri ürün sayfasına yönlendirilir, sepete kendi akışınızla ekler.

### `callback` — önerilen
Sitenizde zaten var olan sepet fonksiyonunun adını verirsiniz:

```js
window.GG = window.GG || {};
GG.addToCart = function ({ sku, size, quantity }) {
  // Sizin mevcut sepet fonksiyonunuz. Promise dönebilir.
  return fetch("/sepet/ekle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku, size, quantity }),
  });
};
```

Fonksiyon yoksa, hata fırlatırsa veya reddederse widget sessizce yutmaz:
müşteri ürün sayfasına yönlendirilir ve olay `cart_bridge_failed` olarak
kaydedilir. Bu sayı panelde ayrı görünür — "yapay zekâ çalışmıyor" görünen
şeyin aslında sepet entegrasyonu olduğu tek bakışta anlaşılır.

### `api` — sepet uç noktanız
Widget sunucusu doğrudan sepet API'nize yazar. Kimlik bilgisi bizde saklanır.

---

## 4. Derin entegrasyon: `window.Rovena`

Loader yüklendiğinde global bir `Rovena` nesnesi oluşur.

| Çağrı | Ne yapar |
|---|---|
| `Rovena.open()` | Danışmanı açar |
| `Rovena.close()` | Kapatır |
| `Rovena.toggle()` | Açık/kapalı değiştirir |
| `Rovena.setProduct(sku)` | Müşterinin baktığı ürünü bildirir |
| `Rovena.setCart([sku, …])` | Sepetteki ürünleri bildirir |
| `Rovena.ask("metin")` | Danışmanı açıp bir soruyu sordurur |
| `Rovena.isReady()` | Widget hazır mı |

### Ürün sayfasında "Bu parçayı kombinle"

En yüksek sepet etkisini veren kullanım budur — müşteri zaten ürüne bakıyorken:

```html
<button onclick="Rovena.setProduct('GG-CT-0412'); Rovena.ask('Bu parçayı neyle kombinlerim?')">
  Bu parçayı kombinle
</button>
```

### Sepeti senkron tutmak

Danışmanın sepetteki ürünü tekrar önermemesi için:

```js
Rovena.setCart(["GG-CT-0412", "GG-GM-2001"]);
```

---

## 5. Ölçümleme

Widget kendi olaylarını kendi sunucusuna gönderir ve **aynı olayları sizin
`dataLayer`'ınıza da yazar**, böylece Rovena'nın katkısı GA4/GTM raporlarınızda
görünür:

```js
window.dataLayer.push({ event: "rovena_add_to_cart", rovena: { sku, size } });
```

Olay listesi sabittir: `widget_open`, `widget_close`, `message_sent`,
`products_shown`, `product_clicked`, `add_to_cart`, `cart_bridge_failed`.

### Ne toplanmaz

Sayfa adresi, referrer, ziyaretçi kimliği, çerez, parmak izi — hiçbiri. Oturum
kimliği widget her yüklendiğinde rastgele üretilir ve siteler arasında
taşınmaz. Rovena müşterilerinizi takip etmez; bu bir ürün kararıdır ve
hukuk incelemesini kısaltmak için böyle tasarlanmıştır.

---

## 6. Sorun giderme

| Belirti | Sebep |
|---|---|
| Widget hiç görünmüyor, konsolda `origin_not_allowed` | Alan adı izinli listede değil. Bize bildirin. |
| Konsolda `data-tenant eksik` | Script etiketinde marka kodu yok. |
| Widget açılıyor ama ürün göstermiyor | Katalog senkronize edilmemiş. Feed raporunu isteyin. |
| Sepete ekleme ürün sayfasına atıyor | `callback` modda fonksiyon bulunamadı veya hata verdi. Konsola bakın. |
| `inline` modda hiçbir şey yok | `data-mount` seçicisi sayfada yok veya script ondan önce çalışıyor. |

Widget yüklenemezse sayfada **hiçbir iz bırakmaz** — bozuk bir düğme veya boş
bir kutu görünmez. Hata yalnızca konsola yazılır.
