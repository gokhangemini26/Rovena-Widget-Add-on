import Link from "next/link";

export const dynamic = "force-static";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f8f6f0",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 540,
          background: "#fff",
          padding: 40,
          borderRadius: 14,
          border: "1px solid #e6dfd5",
          boxShadow: "0 12px 36px rgba(0,0,0,0.06)",
        }}
      >
        <p style={{ letterSpacing: "0.18em", fontSize: 11, textTransform: "uppercase", color: "#8a7f72", margin: 0, fontWeight: 700 }}>
          ROVENA AI STYLIST PLATFORM
        </p>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: "10px 0 14px", color: "#181512" }}>
          Self-Service Merchant Portal & Add-on Engine
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "#554c42", margin: "0 0 24px" }}>
          Moda markaları için bağımsız, gömülebilir ve multi-tenant AI stilist platformu. 
          Kendi XML veya REST API ürün kataloğunuzu bağlayın, stil kurallarınızı belirleyin ve tek satır kodla sitenize ekleyin.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link
            href="/dashboard"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              background: "#181512",
              color: "#fff",
              textDecoration: "none",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            <span>🎛️ Merchant Dashboard'a Git</span>
            <span>→</span>
          </Link>

          <Link
            href="/demo/giovane-gentile"
            target="_blank"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              background: "#fdfbf7",
              color: "#181512",
              border: "1px solid #e6dfd5",
              textDecoration: "none",
              borderRadius: 8,
              fontWeight: 500,
              fontSize: 14,
            }}
          >
            <span>🛍️ Giovane Gentile Canlı Vitrin Demosu</span>
            <span>↗</span>
          </Link>

          <Link
            href="/embed/giovane-gentile"
            target="_blank"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              background: "#fdfbf7",
              color: "#181512",
              border: "1px solid #e6dfd5",
              textDecoration: "none",
              borderRadius: 8,
              fontWeight: 500,
              fontSize: 14,
            }}
          >
            <span>📱 Saf Widget Iframe Görünümü</span>
            <span>↗</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
