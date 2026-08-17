"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import type { Tenant, TenantFeed } from "@/lib/tenant/types";
import type { Product } from "@/lib/catalog/types";

export default function CatalogFeedPage() {
  const params = useParams();
  const slug = params.tenant as string;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Feed Form State
  const [format, setFormat] = useState<"xml" | "json">("xml");
  const [url, setUrl] = useState("");
  const [itemPath, setItemPath] = useState("Urunler.Urun");
  const [refreshHours, setRefreshHours] = useState(24);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({
    sku: "UrunKodu",
    name: "UrunAdi",
    price: "Fiyat",
    image: "Resim",
    category: "Kategori",
    color: "Renk",
    composition: "Kumas",
  });
  const [defaultDepartment, setDefaultDepartment] = useState("men");

  // Live Test State
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    totalItems?: number;
    validItems?: number;
    rejectedCount?: number;
    sampleProducts?: Product[];
    issues?: string[];
    detectedKeys?: string[];
    error?: string;
  } | null>(null);

  // Live Sync State
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<{
    ok: boolean;
    imported?: number;
    fetched?: number;
    rejected?: number;
    issues?: string[];
    durationMs?: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/dashboard/tenants?slug=${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.tenant) {
          setTenant(d.tenant);
          const f: TenantFeed = d.tenant.feed || {};
          setFormat(f.format || "xml");
          setUrl(f.url || "");
          setItemPath(f.itemPath || "Urunler.Urun");
          setRefreshHours(f.refreshHours || 24);
          if (f.map && Object.keys(f.map).length > 0) {
            setFieldMap(f.map);
          }
          if (f.defaults?.department) {
            setDefaultDepartment(f.defaults.department);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  const handleMapChange = (rovenaKey: string, sourceKey: string) => {
    setFieldMap((prev) => ({ ...prev, [rovenaKey]: sourceKey }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setSaving(true);
    setSaveSuccess(false);

    const updatedFeed: TenantFeed = {
      format,
      url: url.trim() || null,
      itemPath: itemPath.trim(),
      refreshHours: Number(refreshHours) || 24,
      map: fieldMap,
      defaults: { department: defaultDepartment },
    };

    const updatedTenant: Tenant = {
      ...tenant,
      feed: updatedFeed,
    };

    try {
      const res = await fetch("/api/dashboard/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedTenant),
      });
      const data = await res.json();
      if (data.ok) {
        setTenant(updatedTenant);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        alert("Hata: " + (data.error || "Kaydedilemedi"));
      }
    } catch (err: unknown) {
      alert("Hata: " + (err instanceof Error ? err.message : "Bağlantı hatası"));
    } finally {
      setSaving(false);
    }
  };

  const handleTestFeed = async () => {
    if (!url.trim()) {
      alert("Lütfen önce bir Feed URL girin.");
      return;
    }
    setTesting(true);
    setTestResult(null);

    const feedConfig: TenantFeed = {
      format,
      url: url.trim(),
      itemPath: itemPath.trim(),
      refreshHours,
      map: fieldMap,
      defaults: { department: defaultDepartment },
    };

    try {
      const res = await fetch("/api/dashboard/feed/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrl: url.trim(), feedConfig }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "Bağlantı hatası",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
    if (!confirm("Feed senkronizasyonu başlatılsın mı? Mevcut katalog güncellenecektir.")) return;
    setSyncing(true);
    setSyncReport(null);

    try {
      const res = await fetch("/api/dashboard/feed/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: slug }),
      });
      const data = await res.json();
      setSyncReport(data);
    } catch (err: unknown) {
      setSyncReport({
        ok: false,
        error: err instanceof Error ? err.message : "Bağlantı hatası",
      });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, color: "var(--db-muted)" }}>Yükleniyor...</div>;
  }

  return (
    <main className="dashboard-main">
      <div className="page-title-group" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="page-title">Ürün Kataloğu & Feed Entegrasyonu</h1>
          <p className="page-desc">
            XML veya REST API ürün beslemenizi bağlayın, alanları eşleyin ve kataloğunuzu senkronize edin.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSyncNow}
            disabled={syncing || !url}
          >
            {syncing ? "Senkronize Ediliyor..." : "⚡ Şimdi Senkronize Et"}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Kaydediliyor..." : saveSuccess ? "Kaydedildi! ✓" : "Ayarları Kaydet 💾"}
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div style={{ padding: 12, background: "#e8f5e9", color: "var(--db-success)", borderRadius: 6, marginBottom: 20, fontSize: 14 }}>
          Katalog yapılandırması başarıyla kaydedildi.
        </div>
      )}

      {/* Sync Execution Report if triggered */}
      {syncReport && (
        <div
          style={{
            padding: 16,
            background: syncReport.ok ? "#e8f5e9" : "#ffebee",
            color: syncReport.ok ? "var(--db-success)" : "var(--db-danger)",
            borderRadius: 8,
            marginBottom: 24,
            border: `1px solid ${syncReport.ok ? "#c8e6c9" : "#ffcdd2"}`,
          }}
        >
          <h4 style={{ margin: "0 0 8px 0" }}>
            {syncReport.ok ? "✅ Senkronizasyon Tamamlandı" : "❌ Senkronizasyon Başarısız"}
          </h4>
          {syncReport.ok ? (
            <p style={{ margin: 0, fontSize: 13 }}>
              <b>{syncReport.fetched}</b> satır okundu, <b>{syncReport.imported}</b> ürün başarıyla kataloğa aktarıldı ({syncReport.durationMs}ms).
              {syncReport.rejected ? ` (${syncReport.rejected} ürün geçersiz olduğu için atlandı).` : ""}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13 }}>Hata: {syncReport.error}</p>
          )}
        </div>
      )}

      {/* 1. Feed Configuration Form */}
      <div className="card">
        <div className="card-title">1. Feed Bağlantı Ayarları</div>

        <form onSubmit={handleSave}>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Feed Biçimi</label>
              <select
                className="form-select"
                value={format}
                onChange={(e) => setFormat(e.target.value as "xml" | "json")}
              >
                <option value="xml">XML (Ticimax, Ideasoft, Shopify, Akakçe, Google)</option>
                <option value="json">JSON / REST API</option>
              </select>
              <div className="form-hint">E-ticaret altyapınızın sağladığı ürün feed formatı.</div>
            </div>

            <div className="form-group">
              <label className="form-label">Ürün Düğümü / Yolu (Item Path)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Örn: Urunler.Urun veya channel.item veya products"
                value={itemPath}
                onChange={(e) => setItemPath(e.target.value)}
                required
              />
              <div className="form-hint">Tek bir ürünü temsil eden XML etiketi veya JSON dizisi yolu.</div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Feed URL (XML / REST API Endpoint)</label>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                type="url"
                className="form-input"
                placeholder="https://marka.com/feeds/products.xml veya https://api.marka.com/v1/products"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestFeed}
                disabled={testing || !url}
                style={{ whiteSpace: "nowrap" }}
              >
                {testing ? "Test Ediliyor..." : "🔍 Feed'i Test Et & İncele"}
              </button>
            </div>
            <div className="form-hint">
              Feed'inizi okuyabilmemiz için URL'nin herkese açık olması veya IP kısıtlaması olmaması gerekir.
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Varsayılan Departman</label>
              <select
                className="form-select"
                value={defaultDepartment}
                onChange={(e) => setDefaultDepartment(e.target.value)}
              >
                <option value="men">Erkek Giyim (Men)</option>
                <option value="women">Kadın Giyim (Women)</option>
                <option value="unisex">Unisex</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Otomatik Senkronizasyon Sıklığı</label>
              <select
                className="form-select"
                value={refreshHours}
                onChange={(e) => setRefreshHours(Number(e.target.value))}
              >
                <option value={6}>6 Saatte Bir</option>
                <option value={12}>12 Saatte Bir</option>
                <option value={24}>Günde Bir Kez (24 Saat)</option>
                <option value={48}>2 Günde Bir Kez</option>
              </select>
            </div>
          </div>
        </form>
      </div>

      {/* 2. Visual Field Mapping */}
      <div className="card">
        <div className="card-title">
          <span>2. Akıllı Alan Eşleştirme (Field Mapping)</span>
          <span style={{ fontSize: 12, fontWeight: "normal", color: "var(--db-muted)" }}>
            Kaynak Feed Alanları ➔ Rovena Alanları
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--db-muted)", marginTop: 0 }}>
          XML/JSON dosyanızdaki etiket adlarını Rovena'nın standart ürün alanlarıyla eşleştirin. Noktalı gösterim desteklenir (Örn: <code>Fiyat.Indirimli</code>).
        </p>

        <table className="mapping-table">
          <thead>
            <tr>
              <th style={{ width: "35%" }}>Rovena Ürün Alanı</th>
              <th style={{ width: "25%" }}>Zorunlu / İsteğe Bağlı</th>
              <th style={{ width: "40%" }}>Sizin Feed Alanınız (Etiket Adı)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>Ürün Kodu (SKU / ID)</b></td>
              <td><span className="tag-badge" style={{ background: "#ffebee", color: "#a82424" }}>Zorunlu</span></td>
              <td>
                <input
                  type="text"
                  className="form-input"
                  value={fieldMap.sku || ""}
                  onChange={(e) => handleMapChange("sku", e.target.value)}
                  placeholder="UrunKodu / id / code"
                />
              </td>
            </tr>

            <tr>
              <td><b>Ürün Başlığı (Title / Name)</b></td>
              <td><span className="tag-badge" style={{ background: "#ffebee", color: "#a82424" }}>Zorunlu</span></td>
              <td>
                <input
                  type="text"
                  className="form-input"
                  value={fieldMap.name || ""}
                  onChange={(e) => handleMapChange("name", e.target.value)}
                  placeholder="UrunAdi / title / name"
                />
              </td>
            </tr>

            <tr>
              <td><b>Satış Fiyatı (Price)</b></td>
              <td><span className="tag-badge" style={{ background: "#ffebee", color: "#a82424" }}>Zorunlu</span></td>
              <td>
                <input
                  type="text"
                  className="form-input"
                  value={fieldMap.price || ""}
                  onChange={(e) => handleMapChange("price", e.target.value)}
                  placeholder="Fiyat / price / sale_price"
                />
              </td>
            </tr>

            <tr>
              <td><b>Ana Görsel URL (Image)</b></td>
              <td><span className="tag-badge" style={{ background: "#ffebee", color: "#a82424" }}>Zorunlu</span></td>
              <td>
                <input
                  type="text"
                  className="form-input"
                  value={fieldMap.image || ""}
                  onChange={(e) => handleMapChange("image", e.target.value)}
                  placeholder="Resim / image_link / photo"
                />
              </td>
            </tr>

            <tr>
              <td><b>Kategori / Tür (Category)</b></td>
              <td><span className="tag-badge">Önerilir</span></td>
              <td>
                <input
                  type="text"
                  className="form-input"
                  value={fieldMap.category || ""}
                  onChange={(e) => handleMapChange("category", e.target.value)}
                  placeholder="Kategori / category / product_type"
                />
              </td>
            </tr>

            <tr>
              <td><b>Renk (Color)</b></td>
              <td><span className="tag-badge">Önerilir</span></td>
              <td>
                <input
                  type="text"
                  className="form-input"
                  value={fieldMap.color || ""}
                  onChange={(e) => handleMapChange("color", e.target.value)}
                  placeholder="Renk / color"
                />
              </td>
            </tr>

            <tr>
              <td><b>Kumaş / Materyal (Composition)</b></td>
              <td><span className="tag-badge">İsteğe Bağlı</span></td>
              <td>
                <input
                  type="text"
                  className="form-input"
                  value={fieldMap.composition || ""}
                  onChange={(e) => handleMapChange("composition", e.target.value)}
                  placeholder="Kumas / material / composition"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. Live Test & Inspection Modal/Results */}
      {testResult && (
        <div className="card" style={{ borderColor: testResult.ok ? "var(--db-border)" : "var(--db-danger)" }}>
          <div className="card-title">
            <span>3. Feed Test & İnceleme Sonuçları</span>
            <span className={`status-pill status-${testResult.ok ? "active" : "paused"}`}>
              {testResult.ok ? "Bağlantı Başarılı" : "Hata Oluştu"}
            </span>
          </div>

          {testResult.ok ? (
            <div>
              <div className="stats-grid" style={{ marginBottom: 16 }}>
                <div className="stat-card">
                  <div className="stat-label">Toplam Bulunan Ürün</div>
                  <div className="stat-value">{testResult.totalItems}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Geçerli / İçe Aktarılabilir</div>
                  <div className="stat-value" style={{ color: "var(--db-success)" }}>{testResult.validItems}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Uyumsuz / Atlanan</div>
                  <div className="stat-value" style={{ color: testResult.rejectedCount ? "var(--db-danger)" : "inherit" }}>
                    {testResult.rejectedCount}
                  </div>
                </div>
              </div>

              {testResult.sampleProducts && testResult.sampleProducts.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 14, margin: "16px 0 10px" }}>Örnek Parse Edilen Ürünler:</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                    {testResult.sampleProducts.slice(0, 4).map((p) => (
                      <div
                        key={p.sku}
                        style={{
                          border: "1px solid var(--db-border)",
                          borderRadius: 6,
                          padding: 12,
                          display: "flex",
                          gap: 12,
                          background: "#fff",
                        }}
                      >
                        {p.imageMain && (
                          <img
                            src={p.imageMain}
                            alt={p.name}
                            style={{ width: 60, height: 80, objectFit: "cover", borderRadius: 4 }}
                          />
                        )}
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {p.name}
                          </p>
                          <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--db-muted)" }}>
                            SKU: {p.sku} · {p.category}
                          </p>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--db-ink)" }}>
                            {p.priceDisplay}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {testResult.issues && testResult.issues.length > 0 && (
                <div style={{ marginTop: 20, padding: 12, background: "#fff8e1", borderRadius: 6 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--db-warning)" }}>
                    ⚠️ Uyumsuzluk / Kalite Bildirimleri:
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#664d03" }}>
                    {testResult.issues.map((iss, idx) => (
                      <li key={idx}>{iss}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--db-danger)", fontSize: 14 }}>
              <p><b>Hata:</b> {testResult.error}</p>
              <p style={{ fontSize: 12, color: "var(--db-muted)" }}>
                Lütfen Feed URL'sinin doğruluğunu, XML/JSON düğüm yolunun (Item Path) ve alan eşleştirmelerinin uygunluğunu kontrol edin.
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
