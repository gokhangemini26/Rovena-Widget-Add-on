"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import type { Tenant, TenantPersona } from "@/lib/tenant/types";

export default function PersonaRulesPage() {
  const params = useParams();
  const slug = params.tenant as string;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Persona fields
  const [displayName, setDisplayName] = useState("");
  const [brief, setBrief] = useState("");
  const [stylingRules, setStylingRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState("");
  const [greetingTr, setGreetingTr] = useState("");
  const [suggestionsTr, setSuggestionsTr] = useState<string[]>([]);
  const [newSuggestion, setNewSuggestion] = useState("");

  useEffect(() => {
    fetch(`/api/dashboard/tenants?slug=${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.tenant) {
          setTenant(d.tenant);
          const p: TenantPersona = d.tenant.persona || {};
          setDisplayName(p.displayName || "");
          setBrief(p.brief || "");
          setStylingRules(p.stylingRules || []);
          setGreetingTr(p.greeting?.tr || "");
          setSuggestionsTr(p.suggestions?.tr || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  const handleAddRule = () => {
    if (!newRule.trim()) return;
    setStylingRules((prev) => [...prev, newRule.trim()]);
    setNewRule("");
  };

  const handleRemoveRule = (index: number) => {
    setStylingRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddSuggestion = () => {
    if (!newSuggestion.trim()) return;
    setSuggestionsTr((prev) => [...prev, newSuggestion.trim()]);
    setNewSuggestion("");
  };

  const handleRemoveSuggestion = (index: number) => {
    setSuggestionsTr((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setSaving(true);
    setSaveSuccess(false);

    const updatedPersona: TenantPersona = {
      displayName: displayName.trim(),
      brief: brief.trim(),
      stylingRules,
      greeting: { tr: greetingTr.trim() },
      suggestions: { tr: suggestionsTr },
      defaultLocale: "tr",
      locales: ["tr"],
    };

    const updatedTenant: Tenant = {
      ...tenant,
      persona: updatedPersona,
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

  if (loading) {
    return <div style={{ padding: 40, color: "var(--db-muted)" }}>Yükleniyor...</div>;
  }

  return (
    <main className="dashboard-main">
      <div className="page-title-group" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="page-title">AI Stilist & Karakter Kuralları</h1>
          <p className="page-desc">
            Yapay zeka stil danışmanınızın dilini, katı kombin kurallarını ve açılış mesajlarını yönetin.
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
          Stilist kuralları ve karakter ayarları başarıyla güncellendi.
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* 1. Identity & Tone */}
        <div className="card">
          <div className="card-title">1. Stilist Kimliği & Marka Dili</div>

          <div className="form-group">
            <label className="form-label">Stilistin Görünen Adı</label>
            <input
              type="text"
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Örn: Giovane Gentile Stil Danışmanı"
              required
            />
            <div className="form-hint">Müşterinin widget başlığında ve karşılama balonunda gördüğü isim.</div>
          </div>

          <div className="form-group">
            <label className="form-label">Marka Dili & Stilist Brief'i</label>
            <textarea
              className="form-textarea"
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Örn: İtalyan terzilik ekolüyle modern şehir erkeğine hitap eden lüks ve sofistike bir stil sunar. Müşteriye samimi ama mesafeli 'Siz' diliyle hitap eder..."
              required
            />
            <div className="form-hint">
              Bu metin doğrudan AI modelinin sistem talimatlarına eklenir. Markanızın tonunu ve felsefesini anlatın.
            </div>
          </div>
        </div>

        {/* 2. Hard Styling Rules */}
        <div className="card">
          <div className="card-title">
            <span>2. Katı Stil & Kombin Kuralları</span>
            <span style={{ fontSize: 12, fontWeight: "normal", color: "var(--db-muted)" }}>
              {stylingRules.length} Kural Tanımlı
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--db-muted)", marginTop: 0 }}>
            Modelin asla çiğnememesi gereken moda kuralları (Örn: renk uyumsuzlukları, kategori yasakları).
          </p>

          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input
              type="text"
              className="form-input"
              placeholder="Örn: Siyah takım elbise altına asla kahverengi ayakkabı önerme."
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddRule();
                }
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={handleAddRule}
              style={{ whiteSpace: "nowrap" }}
            >
              + Kural Ekle
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stylingRules.map((rule, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "var(--db-bg)",
                  borderRadius: 6,
                  border: "1px solid var(--db-border)",
                  fontSize: 13,
                }}
              >
                <span><b>{idx + 1}.</b> {rule}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveRule(idx)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--db-danger)",
                    cursor: "pointer",
                    fontWeight: 700,
                    padding: "2px 6px",
                  }}
                  title="Sil"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Greetings & Starter Chips */}
        <div className="card">
          <div className="card-title">3. Karşılama ve Hızlı Soru Baloncukları</div>

          <div className="form-group">
            <label className="form-label">Açılış Karşılama Mesajı</label>
            <input
              type="text"
              className="form-input"
              value={greetingTr}
              onChange={(e) => setGreetingTr(e.target.value)}
              placeholder="Merhaba! Size özel kombin önerileri hazırlamamı ister misiniz?"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Hazır Başlangıç Soruları (Chips)</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Örn: Hafta sonu şık bir akşam yemeği için ne önerirsin?"
                value={newSuggestion}
                onChange={(e) => setNewSuggestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddSuggestion();
                  }
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleAddSuggestion}
                style={{ whiteSpace: "nowrap" }}
              >
                + Çip Ekle
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {suggestionsTr.map((sug, idx) => (
                <span
                  key={idx}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    background: "var(--db-surface)",
                    border: "1px solid var(--db-border)",
                    borderRadius: 99,
                    fontSize: 12,
                  }}
                >
                  {sug}
                  <button
                    type="button"
                    onClick={() => handleRemoveSuggestion(idx)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#888" }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </form>
    </main>
  );
}
