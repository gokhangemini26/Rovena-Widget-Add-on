/* ═══════════════════════════════════════════════════════════════════════════
   KVKK (6698 Sayılı Kanun) & GDPR Aydınlatma ve Açık Rıza Metinleri
   ═══════════════════════════════════════════════════════════════════════════ */

export interface KvkkTexts {
  consentCheckboxText: string;
  clarificationTitle: string;
  clarificationBody: string;
  dataController: string;
  purposeText: string;
  rightsText: string;
}

export function getKvkkTexts(tenantName: string = "Giovane Gentile"): KvkkTexts {
  return {
    consentCheckboxText:
      "Size özel stil önerileri, beden takibi ve geçmiş kombinlerinizin hatırlanması amacıyla stil tercihlerinizin işlenmesine onay veriyorum.",
    clarificationTitle: `${tenantName} Yapay Zeka Stil Danışmanı Aydınlatma Metni`,
    dataController:
      "Veri Sorumlusu: Ercem Tekstil Sanayi ve Ticaret A.Ş. (Giovane Gentile)",
    purposeText: `Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") m.10 uyarınca, ${tenantName} Dijital Stil Danışmanı hizmetini kullanan ziyaretçilerimizin kişisel verilerinin işlenmesine ilişkin aydınlatma amacıyla hazırlanmıştır.`,
    clarificationBody: `
1. İŞLENEN KİŞİSEL VERİLER VE İŞLEME AMACI:
Dijital Stil Danışmanı'na açık rıza ile verdiğiniz e-posta adresiniz (kriptografik hash olarak saklanır), beden ölçü tercihleriniz, renk/stil beğenileriniz ve önceki alışveriş geçmişiniz; yalnızca size kişiselleştirilmiş ürün kombinleri sunabilmek, beden uyumunu kolaylaştırmak ve geçmiş tercihlerinizi hatırlayabilmek amacıyla işlenmektedir.

2. HUKUKİ SEBEP:
Kişisel verileriniz, KVKK m. 5/1 uyarınca "Açık Rıza" hukuki sebebine dayalı olarak, tamamen sizin iradenizle onay kutucuğunu işaretlemeniz halinde işlenir. Onay vermemeniz halinde sistem "Misafir Modu"nda çalışır ve hiçbir stil hafızası kaydedilmez.

3. YURTDIŞINA AKTARIM VE TEKNOLOJİK ALTYAPI:
Yapay zeka analizleri, Google Cloud Enterprise altyapısı (Gemini API) üzerinden sağlanmaktadır. İletilen veriler, model eğitiminde kullanılmamakta (Zero-Data-Retention) ve gizlilik taahhüdü altındadır.

4. SAKLAMA SÜRESİ VE UNUTULMA HAKKI (KVKK m. 11):
Verileriniz, siz silinmesini talep edene kadar veya azami 1 yıl süreyle stil profilinizde tutulur. Dilediğiniz her an asistan menüsündeki "Stil Hafızamı Temizle" butonuna basarak tüm tercihlerinizi anında ve kalıcı olarak silebilirsiniz.

5. HAKLARINIZ:
KVKK m. 11 kapsamında verilerinizin işlenip işlenmediğini öğrenme, silinmesini veya düzeltilmesini talep etme hakkına sahipsiniz. Başvurularınızı kvkk@giovanegentile.com adresine iletebilirsiniz.
    `.trim(),
    rightsText:
      "Dilediğiniz an 'Stil Hafızamı Temizle' butonuna basarak tüm verilerinizi silebilirsiniz.",
  };
}
