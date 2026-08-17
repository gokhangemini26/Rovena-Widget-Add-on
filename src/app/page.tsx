export const dynamic = "force-static";

/* Deliberately not a marketing page. This deployment serves brands' customers;
   the only thing the root needs to do is point an engineer at the demo and the
   docs, and stay out of search results (robots: noindex in layout.tsx). */

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 440 }}>
        <p style={{ letterSpacing: "0.18em", fontSize: 11, textTransform: "uppercase", color: "#8a7f72" }}>
          Rovena
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 500, margin: "10px 0 12px" }}>
          AI Stylist Add-on
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "#4a4239" }}>
          Markaların kendi sitelerinde çalışan gömülebilir stil danışmanı.
          Kurulum ve feed şartnamesi için <code>docs/</code> klasörüne bakın.
        </p>
        <p style={{ fontSize: 14, marginTop: 18, color: "#8a7f72" }}>
          Demo: <code>/demo/&lt;tenant&gt;</code> · Widget: <code>/embed/&lt;tenant&gt;</code>
        </p>
      </div>
    </main>
  );
}
