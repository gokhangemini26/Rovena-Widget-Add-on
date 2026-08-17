"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Tenant } from "@/lib/tenant/types";

export default function TenantOverviewPage() {
  const params = useParams();
  const slug = params.tenant as string;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/dashboard/tenants?slug=${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.tenant) setTenant(d.tenant);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <div style={{ padding: 40, color: "var(--db-muted)" }}>Yükleniyor...</div>;
  }

  if (!tenant) {
    return <div style={{ padding: 40 }}>Marka bulunamadı.</div>;
  }

  const embedCode = `<script src="https://widget.rovena.ai/rovena.js" data-tenant="${tenant.slug}" defer></script>`;

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasFeed = Boolean(tenant.feed?.url);
  const hasRules = Boolean(tenant.persona?.stylingRules?.length > 0);
  const hasOrigins = Boolean(tenant.allowedOrigins?.length > 0);

  return (
    <main className="dashboard-main">
      <div className="page-title-group" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="page-title">{tenant.name} — Genel Bakış</h1>
          <p className="page-desc">
            Bu panelden {tenant.name} markasının AI Stilist ayarlarını ve entegrasyonunu yönetebilirsiniz.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a
            href={`/demo/${tenant.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            Vitrin Demosunu Aç ↗
          </a>
          <Link href={`/dashboard/${tenant.slug}/design`} className="btn-primary">
            Canlı Önizleme & Tasarım 🎨
          </Link>
        </div>
      </div>

      {/* Checklist Card */}
      <div className="card">
        <div className="card-title">
          <span>🚀 Canlıya Alma Kontrol Listesi</span>
          <span style={{ fontSize: 13, fontWeight: "normal", color: "var(--db-muted)" }}>
            Adım Adım Entegrasyon
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <Link
            href={`/dashboard/${tenant.slug}/catalog`}
            style={{
              border: "1px solid var(--db-border)",
              borderRadius: 8,
              padding: 16,
              textDecoration: "none",
              color: "inherit",
              background: hasFeed ? "var(--db-surface)" : "#fffcf7",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>1. Ürün Kataloğu</span>
              <span>{hasFeed ? "✅" : "⚠️"}</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: 0 }}>
              {hasFeed ? "XML / API Feed bağlı" : "Feed adresi tanımlayın"}
            </p>
          </Link>

          <Link
            href={`/dashboard/${tenant.slug}/persona`}
            style={{
              border: "1px solid var(--db-border)",
              borderRadius: 8,
              padding: 16,
              textDecoration: "none",
              color: "inherit",
              background: hasRules ? "var(--db-surface)" : "#fffcf7",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>2. Stilist Kuralları</span>
              <span>{hasRules ? "✅" : "⚠️"}</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: 0 }}>
              {hasRules ? `${tenant.persona.stylingRules.length} kural tanımlı` : "Kombin kurallarını girin"}
            </p>
          </Link>

          <Link
            href={`/dashboard/${tenant.slug}/design`}
            style={{
              border: "1px solid var(--db-border)",
              borderRadius: 8,
              padding: 16,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>3. Renk & Tasarım</span>
              <span>✅</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: 0 }}>
              Marka renkleri ve tipografi
            </p>
          </Link>

          <Link
            href={`/dashboard/${tenant.slug}/integration`}
            style={{
              border: "1px solid var(--db-border)",
              borderRadius: 8,
              padding: 16,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>4. Güvenlik & Script</span>
              <span>{hasOrigins ? "✅" : "⚠️"}</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: 0 }}>
              İzinli domain ve kurulum kodu
            </p>
          </Link>
        </div>
      </div>

      {/* Embed Script Quick Box */}
      <div className="card">
        <div className="card-title">
          <span>Tek Satır Kurulum Kodu (Embed Script)</span>
          <button type="button" className="btn-copy" onClick={copyEmbed} style={{ position: "static" }}>
            {copied ? "Kopyalandı! ✓" : "Kodu Kopyala 📋"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--db-muted)", marginTop: 0 }}>
          Bu kodu sitenizin <code>&lt;body&gt;</code> veya <code>&lt;head&gt;</code> bölümüne eklediğiniz anda AI stilist aktif hale gelecektir.
        </p>
        <div className="code-box">
          <code>{embedCode}</code>
        </div>
      </div>

      {/* Key Config Summary */}
      <div className="card">
        <div className="card-title">Yapılandırma Özeti</div>
        <div className="form-grid-2">
          <div>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: "0 0 4px" }}>Stilist Adı</p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px" }}>{tenant.persona?.displayName}</p>

            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: "0 0 4px" }}>Sepet Modu</p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px" }}>{tenant.cart?.mode}</p>
          </div>

          <div>
            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: "0 0 4px" }}>İzin Verilen Alan Adları</p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px" }}>
              {tenant.allowedOrigins?.join(", ") || "Belirtilmedi"}
            </p>

            <p style={{ fontSize: 12, color: "var(--db-muted)", margin: "0 0 4px" }}>Katalog Kaynağı</p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px" }}>
              {tenant.feed?.url || "Özel JSON / Yerel Dosya"}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
