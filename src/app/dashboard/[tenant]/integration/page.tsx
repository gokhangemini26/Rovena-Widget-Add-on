"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import type { Tenant, TenantCart } from "@/lib/tenant/types";

export default function IntegrationPage() {
  const params = useParams();
  const slug = params.tenant as string;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  // Origins & Cart
  const [origins, setOrigins] = useState<string[]>([]);
  const [newOrigin, setNewOrigin] = useState("");
  const [cartMode, setCartMode] = useState<"redirect" | "callback" | "api">("redirect");
  const [callbackName, setCallbackName] = useState("rovenaAddToCart");
  const [apiUrl, setApiUrl] = useState("");

  useEffect(() => {
    fetch(`/api/dashboard/tenants?slug=${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.tenant) {
          setTenant(d.tenant);
          setOrigins(d.tenant.allowedOrigins || []);
          const c: TenantCart = d.tenant.cart || {};
          setCartMode(c.mode || "redirect");
          setCallbackName(c.callbackName || "rovenaAddToCart");
          setApiUrl(c.apiUrl || "");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  const handleAddOrigin = () => {
    if (!newOrigin.trim()) return;
    let url = newOrigin.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    setOrigins((prev) => [...prev, url]);
    setNewOrigin("");
  };

  const handleRemoveOrigin = (index: number) => {
    setOrigins((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setSaving(true);
    setSaveSuccess(false);

    const updatedTenant: Tenant = {
      ...tenant,
      allowedOrigins: origins,
      cart: {
        mode: cartMode,
        callbackName: cartMode === "callback" ? callbackName.trim() : undefined,
        apiUrl: cartMode === "api" ? apiUrl.trim() : undefined,
      },
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

  const embedCode = `<script src="https://widget.rovena.ai/rovena.js" data-tenant="${slug}" defer></script>`;

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div style={{ padding: 40, color: "var(--db-muted)" }}>Yükleniyor...</div>;
  }

  return (
    <main className="dashboard-main">
      <div className="page-title-group" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="page-title">Güvenlik, Sepet & Kurulum Kodu</h1>
          <p className="page-desc">
            İzinli web sitelerinizi tanımlayın, sepet köprüsünü ayarlayın ve sitenize ekleyeceğiniz script kodunu alın.
          </p>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Kaydediliyor..." : saveSuccess ? "Kaydedildi! ✓" : "Değişiklikleri Kaydet 💾"}
        </button>
      </div>

      {saveSuccess && (
        <div style={{ padding: 12, background: "#e8f5e9", color: "var(--db-success)", borderRadius: 6, marginBottom: 20, fontSize: 14 }}>
          Güvenlik ve entegrasyon ayarları başarıyla güncellendi.
        </div>
      )}

      {/* 1. Embed Code Snippet */}
      <div className="card">
        <div className="card-title">
          <span>1. Tek Satır Evrensel Script (Universal Embed Code)</span>
          <button type="button" className="btn-copy" onClick={copyEmbed} style={{ position: "static" }}>
            {copied ? "Kopyalandı! ✓" : "Kodu Kopyala 📋"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--db-muted)", marginTop: 0 }}>
          Bu script etiketini e-ticaret sitenizin tüm sayfalarına (örneğin <code>theme.liquid</code>, <code>layout.tsx</code> veya Google Tag Manager) yapıştırın.
        </p>

        <div className="code-box">
          <code>{embedCode}</code>
        </div>
      </div>

      {/* 2. Security Whitelist */}
      <div className="card">
        <div className="card-title">
          <span>2. İzin Verilen Alan Adları (Security Origin Whitelist)</span>
          <span style={{ fontSize: 12, fontWeight: "normal", color: "var(--db-muted)" }}>
            {origins.length} Alan Adı Yetkili
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--db-muted)", marginTop: 0 }}>
          Widget'ınızın sadece belirttiğiniz alan adlarında çalışmasını sağlar. Başka sitelerin kodunuzu kopyalamasını engeller.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input
            type="text"
            className="form-input"
            placeholder="https://www.giovanegentile.com veya http://localhost:3000"
            value={newOrigin}
            onChange={(e) => setNewOrigin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddOrigin();
              }
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={handleAddOrigin}
            style={{ whiteSpace: "nowrap" }}
          >
            + Domain Ekle
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {origins.map((org, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "var(--db-bg)",
                borderRadius: 6,
                border: "1px solid var(--db-border)",
                fontSize: 13,
              }}
            >
              <span>🔒 <code>{org}</code></span>
              <button
                type="button"
                onClick={() => handleRemoveOrigin(idx)}
                style={{ background: "none", border: "none", color: "var(--db-danger)", cursor: "pointer", fontWeight: 700 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Cart Bridge */}
      <div className="card">
        <div className="card-title">3. Sepet Köprüsü (Cart Bridge Modu)</div>

        <div className="form-group">
          <label className="form-label">Sepete Ekleme Davranışı</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
              <input
                type="radio"
                name="cartMode"
                value="redirect"
                checked={cartMode === "redirect"}
                onChange={() => setCartMode("redirect")}
                style={{ marginTop: 3 }}
              />
              <div>
                <b style={{ fontSize: 13 }}>Ürün Sayfasına Yönlendir (Redirect - Sıfır Efor)</b>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--db-muted)" }}>
                  Kullanıcı "Satın Al" veya "Sepete Ekle" dediğinde markanın ilgili ürün sayfasına yönlendirilir.
                </p>
              </div>
            </label>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
              <input
                type="radio"
                name="cartMode"
                value="callback"
                checked={cartMode === "callback"}
                onChange={() => setCartMode("callback")}
                style={{ marginTop: 3 }}
              />
              <div>
                <b style={{ fontSize: 13 }}>JavaScript Callback Fonksiyonu (Tavsiye Edilen)</b>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--db-muted)" }}>
                  Sitenizdeki mevcut sepet fonksiyonunu çağırır. Sayfa yenilenmeden ürün sepete eklenir.
                </p>
              </div>
            </label>
          </div>
        </div>

        {cartMode === "callback" && (
          <div className="form-group" style={{ marginTop: 16, background: "var(--db-bg)", padding: 16, borderRadius: 8 }}>
            <label className="form-label">Sitenizdeki Global Sepet Fonksiyonunun Adı</label>
            <input
              type="text"
              className="form-input"
              value={callbackName}
              onChange={(e) => setCallbackName(e.target.value)}
              placeholder="rovenaAddToCart veya GG.addToCart"
            />
            <div className="form-hint">
              Siteniz bu fonksiyonu tanımlamalıdır: <code>window.{callbackName} = function({`{ sku, size, quantity }`}) {`{ ... }`}</code>
            </div>
          </div>
        )}
      </div>

      {/* 4. Platform-Specific Guides */}
      <div className="card">
        <div className="card-title">4. Platform Kurulum Kılavuzları</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          <div style={{ border: "1px solid var(--db-border)", borderRadius: 8, padding: 16 }}>
            <h4 style={{ margin: "0 0 6px" }}>🛍️ Shopify</h4>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: 0, lineHeight: 1.5 }}>
              <b>Online Store → Themes → Edit code → theme.liquid</b> dosyasına gidin. <code>&lt;/body&gt;</code> etiketinin hemen üstüne script kodunu yapıştırın.
            </p>
          </div>

          <div style={{ border: "1px solid var(--db-border)", borderRadius: 8, padding: 16 }}>
            <h4 style={{ margin: "0 0 6px" }}>📦 Ticimax / Ideasoft</h4>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: 0, lineHeight: 1.5 }}>
              <b>Yönetim Paneli → Tasarım Ayarları → Özel Kod / JS Ekleme</b> alanına script kodunu ekleyin ve kaydedin.
            </p>
          </div>

          <div style={{ border: "1px solid var(--db-border)", borderRadius: 8, padding: 16 }}>
            <h4 style={{ margin: "0 0 6px" }}>🏷️ Google Tag Manager</h4>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: 0, lineHeight: 1.5 }}>
              Yeni bir <b>Custom HTML Tag</b> oluşturun, kodu yapıştırın ve <b>All Pages (Tüm Sayfalar)</b> tetikleyicisini seçip yayınlayın.
            </p>
          </div>

          <div style={{ border: "1px solid var(--db-border)", borderRadius: 8, padding: 16 }}>
            <h4 style={{ margin: "0 0 6px" }}>⚛️ Next.js / React</h4>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: 0, lineHeight: 1.5 }}>
              <code>app/layout.tsx</code> dosyanıza <code>&lt;Script src="..." strategy="lazyOnload" /&gt;</code> olarak ekleyin.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
