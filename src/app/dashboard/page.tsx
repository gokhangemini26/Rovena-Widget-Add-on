"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Tenant } from "@/lib/tenant/types";

export default function DashboardHome() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dashboard/tenants");
      const data = await res.json();
      if (data.tenants) {
        setTenants(data.tenants);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSlug || !newName) return;

    setCreating(true);
    setError("");

    const newTenant: Tenant = {
      slug: newSlug.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-"),
      name: newName.trim(),
      status: "active",
      allowedOrigins: ["http://localhost:3000", "https://*.vercel.app"],
      theme: {
        accent: "#181512",
        accentInk: "#FFFFFF",
        surface: "#FDFBF7",
        ink: "#181512",
        muted: "#72685D",
        line: "#E6DFD5",
        fontDisplay: "Fraunces, serif",
        fontBody: "Outfit, sans-serif",
        radius: 12,
        position: "bottom-right",
      },
      persona: {
        displayName: `${newName} Stil Danışmanı`,
        brief: `${newName} için kişiye özel, lüks ve sofistike stil danışmanlığı sağlar.`,
        stylingRules: ["Koleksiyondaki uyumlu parçaları birbiriyle eşleştir."],
        greeting: {
          tr: `Merhaba! ${newName} koleksiyonundan size özel kombinler hazırlamamı ister misiniz?`,
        },
        suggestions: {
          tr: ["Bugünün öne çıkan kombinleri", "Özel davet için takım önerisi"],
        },
        defaultLocale: "tr",
        locales: ["tr"],
      },
      feed: {
        url: null,
        format: "xml",
        itemPath: "Urunler.Urun",
        map: {
          sku: "UrunKodu",
          name: "UrunAdi",
          price: "Fiyat",
          image: "Resim",
          category: "Kategori",
        },
        refreshHours: 24,
      },
      inventory: {
        mode: "assumed",
        lowStockThreshold: 3,
      },
      cart: {
        mode: "redirect",
      },
      limits: {
        messagesPerSession: 40,
        requestsPerMinute: 30,
        conversationsPerMonth: 1000,
      },
    };

    try {
      const res = await fetch("/api/dashboard/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTenant),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Oluşturulamadı");
      } else {
        setShowModal(false);
        router.push(`/dashboard/${newTenant.slug}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bağlantı hatası");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="dashboard-main" style={{ width: "100%" }}>
      <div className="page-title-group" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">Rovena Merchant Portalı</h1>
          <p className="page-desc">
            Moda markalarınız için AI stilist eklentilerini (Add-on) yönetin, XML/API kataloglarını bağlayın ve canlıya alın.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowModal(true)}
        >
          + Yeni Marka / Eklenti Oluştur
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Tanımlı Markalar</div>
          <div className="stat-value">{tenants.length}</div>
          <div className="stat-sub">Aktif Eklenti Sayısı</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Toplam Katalog Ürünü</div>
          <div className="stat-value">1,420+</div>
          <div className="stat-sub">Senkronize Edilmiş</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Aylık Görüşme</div>
          <div className="stat-value">2,840</div>
          <div className="stat-sub">↑ %24 bu ay</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ortalama Sepete Ekleme</div>
          <div className="stat-value">%18.4</div>
          <div className="stat-sub">Dönüşüm Oranı</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Kayıtlı Markalar & AI Stilist Eklentileri</span>
          <span style={{ fontSize: 12, fontWeight: "normal", color: "var(--db-muted)" }}>
            {tenants.length} Marka Listelendi
          </span>
        </div>

        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--db-muted)" }}>
            Markalar yükleniyor...
          </div>
        ) : tenants.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--db-muted)" }}>
            Henüz kayıtlı bir marka bulunamadı. "+ Yeni Marka Oluştur" butonuna basarak başlayabilirsiniz.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {tenants.map((t) => (
              <div
                key={t.slug}
                style={{
                  border: "1px solid var(--db-border)",
                  borderRadius: "8px",
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  background: "var(--db-surface)",
                  boxShadow: "var(--db-shadow-sm)",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{t.name}</h3>
                    <span className={`status-pill status-${t.status || "active"}`}>
                      {t.status || "active"}
                    </span>
                  </div>
                  <p style={{ margin: "0 0 14px 0", fontSize: 12, color: "var(--db-muted)" }}>
                    Slug: <code>{t.slug}</code> · Feed: {t.feed?.url ? "Bağlı (XML/API)" : "Yerel Katalog"}
                  </p>
                  <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                    <span className="tag-badge">Stilist: {t.persona?.displayName}</span>
                    <span className="tag-badge">Pozisyon: {t.theme?.position}</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12, borderTop: "1px solid var(--db-border)", paddingTop: 14 }}>
                  <Link
                    href={`/dashboard/${t.slug}`}
                    className="btn-primary"
                    style={{ flex: 1, textAlign: "center", justifyContent: "center", textDecoration: "none", fontSize: 13, padding: "8px 12px" }}
                  >
                    Yönet ⚙️
                  </Link>
                  <a
                    href={`/demo/${t.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary"
                    style={{ textDecoration: "none", fontSize: 13, padding: "8px 12px" }}
                  >
                    Vitrin ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Tenant Modal */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 32,
              maxWidth: 480,
              width: "90%",
              boxShadow: "var(--db-shadow-lg)",
            }}
          >
            <h2 style={{ margin: "0 0 8px 0", fontSize: 20 }}>Yeni AI Stilist Eklentisi Ekle</h2>
            <p style={{ margin: "0 0 20px 0", fontSize: 13, color: "var(--db-muted)" }}>
              Marka adını ve sistem kodunu (slug) girerek başlayın. Ardından katalog ve tema ayarlarını yapılandırabilirsiniz.
            </p>

            {error && (
              <div style={{ padding: "10px 14px", background: "#ffebee", color: "var(--db-danger)", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleCreateTenant}>
              <div className="form-group">
                <label className="form-label">Marka Adı</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Örn: Giovane Gentile, Vakko, Beymen"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (!newSlug) {
                      setNewSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]/g, "-"));
                    }
                  }}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Eklenti Kodu (Slug)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Örn: giovane-gentile"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-"))}
                  required
                />
                <div className="form-hint">
                  Script etiketinde <code>data-tenant="{newSlug || 'marka-adi'}"</code> olarak kullanılacaktır.
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
                  disabled={creating}
                >
                  İptal
                </button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? "Oluşturuluyor..." : "Oluştur ve Yapılandır →"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
