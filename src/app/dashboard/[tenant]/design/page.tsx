"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import type { Tenant, TenantTheme } from "@/lib/tenant/types";
import { LivePreview } from "@/components/dashboard/LivePreview";

export default function DesignCustomizerPage() {
  const params = useParams();
  const slug = params.tenant as string;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Theme states
  const [accent, setAccent] = useState("#181512");
  const [accentInk, setAccentInk] = useState("#ffffff");
  const [surface, setSurface] = useState("#fdfbf7");
  const [ink, setInk] = useState("#181512");
  const [muted, setMuted] = useState("#72685d");
  const [line, setLine] = useState("#e6dfd5");
  const [radius, setRadius] = useState(12);
  const [position, setPosition] = useState<"bottom-right" | "bottom-left">("bottom-right");
  const [fontDisplay, setFontDisplay] = useState("Fraunces, serif");
  const [fontBody, setFontBody] = useState("Outfit, sans-serif");
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    fetch(`/api/dashboard/tenants?slug=${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.tenant) {
          setTenant(d.tenant);
          const t: TenantTheme = d.tenant.theme || {};
          setAccent(t.accent || "#181512");
          setAccentInk(t.accentInk || "#ffffff");
          setSurface(t.surface || "#fdfbf7");
          setInk(t.ink || "#181512");
          setMuted(t.muted || "#72685d");
          setLine(t.line || "#e6dfd5");
          setRadius(t.radius ?? 12);
          setPosition(t.position || "bottom-right");
          setFontDisplay(t.fontDisplay || "Fraunces, serif");
          setFontBody(t.fontBody || "Outfit, sans-serif");
          setLogoUrl(t.logoUrl || "");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!tenant) return;
    setSaving(true);
    setSaveSuccess(false);

    const updatedTheme: TenantTheme = {
      accent,
      accentInk,
      surface,
      ink,
      muted,
      line,
      radius: Number(radius) || 12,
      position,
      fontDisplay,
      fontBody,
      logoUrl: logoUrl.trim() || undefined,
    };

    const updatedTenant: Tenant = {
      ...tenant,
      theme: updatedTheme,
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
        setRefreshKey((k) => k + 1);
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

  if (loading) {
    return <div style={{ padding: 40, color: "var(--db-muted)" }}>Yükleniyor...</div>;
  }

  if (!tenant) {
    return <div style={{ padding: 40 }}>Marka bulunamadı.</div>;
  }

  const currentTheme: TenantTheme = {
    accent,
    accentInk,
    surface,
    ink,
    muted,
    line,
    radius,
    position,
    fontDisplay,
    fontBody,
    logoUrl,
  };

  return (
    <main className="dashboard-main" style={{ maxWidth: 1400 }}>
      <div className="page-title-group" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="page-title">Görsel Tasarım & Canlı Önizleme</h1>
          <p className="page-desc">
            Marka renklerinizi, köşe yuvarlaklığını ve logo ayarlarınızı sağdaki interaktif simülatörde anında test edin.
          </p>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={() => handleSave()}
          disabled={saving}
        >
          {saving ? "Uygulanıyor..." : saveSuccess ? "Uygulandı! ✓" : "Değişiklikleri Kaydet & Simüle Et 🎨"}
        </button>
      </div>

      {saveSuccess && (
        <div style={{ padding: 12, background: "#e8f5e9", color: "var(--db-success)", borderRadius: 6, marginBottom: 20, fontSize: 14 }}>
          Tasarım ayarları başarıyla kaydedildi ve önizleme yenilendi.
        </div>
      )}

      <div className="dashboard-split-view">
        {/* Left Side: Controls Form */}
        <div>
          {/* 1. Colors */}
          <div className="card">
            <div className="card-title">1. Marka Renk Paleti</div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Ana Vurgu Rengi (Accent)</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="color"
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                    style={{ width: 44, height: 38, border: "1px solid var(--db-border)", borderRadius: 4, cursor: "pointer", padding: 2 }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                  />
                </div>
                <div className="form-hint">Butonlar, başlatıcı ve aktif öğeler.</div>
              </div>

              <div className="form-group">
                <label className="form-label">Vurgu Üstü Yazı (Accent Ink)</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="color"
                    value={accentInk}
                    onChange={(e) => setAccentInk(e.target.value)}
                    style={{ width: 44, height: 38, border: "1px solid var(--db-border)", borderRadius: 4, cursor: "pointer", padding: 2 }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    value={accentInk}
                    onChange={(e) => setAccentInk(e.target.value)}
                  />
                </div>
                <div className="form-hint">Buton üzerindeki metin rengi.</div>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Panel Arka Planı (Surface)</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="color"
                    value={surface}
                    onChange={(e) => setSurface(e.target.value)}
                    style={{ width: 44, height: 38, border: "1px solid var(--db-border)", borderRadius: 4, cursor: "pointer", padding: 2 }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    value={surface}
                    onChange={(e) => setSurface(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Ana Metin Rengi (Ink)</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="color"
                    value={ink}
                    onChange={(e) => setInk(e.target.value)}
                    style={{ width: 44, height: 38, border: "1px solid var(--db-border)", borderRadius: 4, cursor: "pointer", padding: 2 }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    value={ink}
                    onChange={(e) => setInk(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 2. Shape & Placement */}
          <div className="card">
            <div className="card-title">2. Geometri & Konumlandırma</div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Ekran Konumu</label>
                <select
                  className="form-select"
                  value={position}
                  onChange={(e) => setPosition(e.target.value as "bottom-right" | "bottom-left")}
                >
                  <option value="bottom-right">Sağ Alt Köşe (Önerilen)</option>
                  <option value="bottom-left">Sol Alt Köşe</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Köşe Yuvarlaklığı ({radius}px)</label>
                <input
                  type="range"
                  min={0}
                  max={24}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--db-ink)" }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Marka Logo URL (Opsiyonel)</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://marka.com/logo-icon.png"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
              />
              <div className="form-hint">Widget başlığında ve başlatıcı butonunda gösterilecek kare logo.</div>
            </div>
          </div>

          {/* 3. Typography */}
          <div className="card">
            <div className="card-title">3. Tipografi & Fontlar</div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Başlık Fontu (Display)</label>
                <input
                  type="text"
                  className="form-input"
                  value={fontDisplay}
                  onChange={(e) => setFontDisplay(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Gövde Fontu (Body)</label>
                <input
                  type="text"
                  className="form-input"
                  value={fontBody}
                  onChange={(e) => setFontBody(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Interactive Live Simulator */}
        <div>
          <LivePreview
            tenantSlug={slug}
            theme={currentTheme}
            persona={tenant.persona}
            refreshKey={refreshKey}
          />
        </div>
      </div>
    </main>
  );
}
