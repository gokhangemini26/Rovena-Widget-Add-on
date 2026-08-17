# Ürün Feed Şartnamesi

**Kime:** Markanın ERP / e-ticaret ekibine (Giovane Gentile için: Liva Soft)
**Sürüm:** 1.0

Bu belge, Rovena'nın markanın kataloğunu okuyabilmesi için beklenen veri
formatını tanımlar. Amaç yeni bir geliştirme yaptırmak değil, **halihazırda
ürettiğiniz feed'i kullanmaktır**. Alan adlarınız farklıysa eşleme bizim
tarafımızda yapılır; aşağıdaki isimler Rovena'nın iç adlandırmasıdır, sizin
alan adlarınızı değiştirmeniz gerekmez.

---

## 1. Teslimat

| | |
|---|---|
| Format | XML veya JSON |
| Adres | HTTPS üzerinden sabit bir URL |
| Kimlik doğrulama | Basic auth, token veya IP kısıtı — hangisi kolaysa |
| Sıklık | Günde en az 1, tercihen 4 saatte 1 |
| Kapsam | Tam katalog. Artımlı/delta gerekmez. |

Feed'de olmayan ürün pasife alınır, silinmez; ertesi gün geri gelirse geçmişini
korur.

**Güvenlik durdurması:** Bir senkronizasyon mevcut kataloğun %40'ından fazlasını
silecek olursa işlem durdurulur ve katalog değiştirilmez. Feed'iniz yarım
geldiğinde mağazanız satmaya devam eder. Aynı şekilde feed indirilemez veya
ayrıştırılamazsa da mevcut katalog korunur.

---

## 2. Zorunlu alanlar

Bu altı alan olmadan ürün kataloğa **alınmaz**. Eksik alanlar rapor edilir.

| Alan | Açıklama | Örnek |
|---|---|---|
| `sku` | Değişmeyen benzersiz ürün kodu | `GG-CT-0412` |
| `name` | Ürün adı | `Yünlü Çift Düğmeli Ceket` |
| `department` | `erkek` / `kadın` / `unisex` | `Erkek` |
| `price` + `currency` | Güncel satış fiyatı | `12.900,00` / `TRY` |
| `imageMain` | Ana ürün görseli, doğrudan erişilebilir URL | `https://…/gg-ct-0412.jpg` |
| `productUrl` | Ürünün sitedeki sayfası | `https://…/p/gg-ct-0412` |

### `sku` neden değişmemeli

Rovena kombin ilişkilerini, performans ölçümünü ve sepet aktarımını sku
üzerinden yürütür. Sku değişirse ürün yeni bir ürün olarak görünür ve geçmişi
kopar.

### `department` neden zorunlu

Rovena'nın kadın ve erkek koleksiyonlarını karıştırmamasını sağlayan kilit bu
alana bağlıdır. Boş bırakılan bir ürün için varsayılan **atanmaz** — ürün
kataloğa alınmaz. Yanlış departmanda görünen bir ürünü önce müşteri görür;
eksik bir ürünü önce siz görürsünüz.

Tek departmanlı markalarda (ör. yalnızca erkek giyim) bu alan feed'de hiç
olmayabilir; sabit değer bizim tarafımızda tanımlanır.

Kodlu gönderiyorsanız (`1`/`2`, `E`/`K`) eşleme tablosu tanımlanır, alanı
değiştirmeniz gerekmez.

### Fiyat formatı

`12.900,00` ve `12,900.00` yazımlarının ikisi de doğru okunur; son ayraç ondalık
kabul edilir. `12.900` on iki bin dokuz yüz olarak okunur, 12,9 olarak değil.

---

## 3. Şiddetle önerilen alanlar

Bunlar zorunlu değildir ama **danışmanlığın kalitesini doğrudan belirler**.
Renk ve kumaş olmadan Rovena bir arama kutusuna yaklaşır; bunlarla bir stiliste.

| Alan | Ne sağlar | Örnek |
|---|---|---|
| `color` | Renk uyumu motorunun girdisi | `Lacivert` |
| `composition` | "Yazlık bir şey" sorusunun cevabı | `%70 Yün %30 Polyester` |
| `category` | Parçanın kombindeki katmanı buradan çıkarılır | `Ceket` |
| `season` | Mevsim filtresi | `Sonbahar` / `AW` / `4 Mevsim` |
| `sizes` | Beden listesi | `48,50,52,54` |
| `sizeSystem` | Yanlış beden önerisinin en yaygın sebebi | `EU` / `IT` / `TR` |
| `description` | Ürünü anlatırken kullanılan dil | serbest metin |
| `care` | Bakım talimatı | serbest metin |
| `imageDetail` | Doku/detay görseli | URL |
| `imageModel` | Manken üzerindeki görsel | URL |
| `relatedSkus` | **Markanın kendi kombin önerileri** | `GG-PT-0311, GG-SH-0102` |
| `stock` | Bölüm 5 | `7` |

`relatedSkus` bir feed'deki en değerli isteğe bağlı alandır: kombin grafiğinin
başlangıç tohumudur ve markanın kendi merchandising bilgisini sisteme taşır.

### `category` nasıl kullanılır

Kendi kategori adlarınız aynen korunur; Rovena bunlardan parçanın kombindeki
yerini çıkarır (üst / alt / dış giyim / takım / ayakkabı / çanta / aksesuar).
Türkçe ekler sorun değildir: `Ceket`, `Erkek Ceketi`, `Ceketler` aynı sonucu
verir. Çıkarılamayan ürünler kataloğa girer, önerilir, ancak kombine dahil
edilmez ve raporda listelenir.

### Beden ve stok satırları

Feed'iniz her beden için ayrı satır üretiyorsa bunu belirtin — aksi halde aynı
sku birden fazla kez görünür, ilki alınır ve kalanı raporda "tekrarlanan sku"
olarak listelenir.

---

## 4. Görsel kriterleri

Sanal deneme özelliği için gereklidir; sohbet ve öneri bunlarsız da çalışır.

- Düz ürün çekimi (packshot), tercihen düz ve açık renkli fon
- Ürünün tamamı kadrajda, kesilmemiş
- Kısa kenar en az 1000 piksel
- Ürünün gerçek rengini veren ışık — renk kayması sanal denemede yanlış renk üretir
- Tercihen filigransız
- URL'ler giriş gerektirmeden erişilebilir olmalı

Kriterleri sağlamayan ürünler kataloğa alınır ve önerilir; yalnızca o ürünler
için sanal deneme kapatılır. Aktarım sonrası görsel kalite raporu iletilir.

---

## 5. Stok — üç seçenek

**A · Feed içinde stok.** Beden kırılımında `stock` alanı, 15 dakikada bir
tazelenen feed. Ek geliştirme gerektirmez.

**B · Stok uç noktası.** `sku` ve `size` alıp mevcudiyet dönen basit bir HTTPS
adresi. Rovena buraya yalnızca müşteri stok sorduğunda başvurur, sürekli
sorgulamaz.

Beklenen yanıt (iki biçim de kabul edilir):

```json
{ "items": [ { "size": "50", "quantity": 4 }, { "size": "52", "quantity": 0 } ] }
```

`quantity` yerine `available: true/false` da olur. Alan adları `beden`, `stok`,
`mevcut` olarak da gelebilir.

**C · Stok bağlantısı yok.** Rovena stok hakkında hiçbir beyanda bulunmaz.

### Stok taahhüdü

Stok bilgisi yapay zekâ modelinin bağlamına **hiçbir koşulda doğrudan girmez**.
Model yalnızca mağaza sisteminden doğrulanmış bir yanıtı aktarabilir; yanıt yoksa
"kontrol edip döneyim" der. Uç nokta zaman aşımına uğrarsa sonuç "bilinmiyor"
olur ve **asla "mevcut" sayılmaz**.

Yani "stokta var", "son bir tane kaldı", "sizin için ayırayım" cümleleri bir
yazım tercihiyle engellenmiş değildir — sistemin veri kuralı gereği kurulamaz.

---

## 6. Senkronizasyon raporu

Her senkronizasyon bir rapor döndürür. Bu rapor karşılıklı iş listesidir:

```json
{
  "ok": true,
  "fetched": 5120,
  "imported": 4980,
  "rejected": 140,
  "removed": 12,
  "issues": [
    "Zorunlu alan eksik veya okunamadı: department (sku: GG-XX-0091)",
    "Parça tipi çıkarılamadı, kombine girmeyecek (sku: GG-HD-0002)",
    "Beden bilgisi yok (sku: GG-AK-0455)"
  ]
}
```

Reddedilen satırlar bizim tarafımızda yamalanmaz — hangi ürünün neden
alınamadığı size bildirilir, düzeltme feed'de yapılır. Bu, ilk haftalarda
katalog kalitesini hızla yukarı çeken tek yöntemdir.

---

## 7. Kontrol listesi

**Katalog (zorunlu)**
- [ ] Tam katalog feed'i, sabit HTTPS adresi
- [ ] Kimlik doğrulama yöntemi belirlendi
- [ ] Tazeleme sıklığı: günde en az 1
- [ ] Zorunlu alanlar mevcut (Bölüm 2)
- [ ] `sku` değerlerinin değişmeyeceği teyit edildi
- [ ] Önerilen alanlardan hangilerinin gönderilebileceği belirlendi (Bölüm 3)
- [ ] Feed'in ürün bazlı mı beden bazlı mı olduğu belirtildi

**Stok (opsiyonel)**
- [ ] Seçenek A, B veya C seçildi

**Görseller**
- [ ] URL'ler giriş gerektirmeden erişilebilir
- [ ] Bölüm 4 kriterlerine uygunluk durumu bildirildi
- [ ] Kadın/erkek için birer referans manken görseli (sanal deneme için)

**Sepet (opsiyonel)**
- [ ] Sitedeki "sepete ekle" JavaScript fonksiyonunun adı, **veya**
- [ ] Sepet API'si dokümanı

**Ortam**
- [ ] Varsa test ortamının feed adresi
- [ ] Widget'ın çalışacağı alan adları (izinli origin listesi için)
- [ ] Teknik irtibat kişisi
