import Script from "next/script";
import { notFound } from "next/navigation";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { DemoActions } from "@/components/DemoActions";

export const dynamic = "force-dynamic";

/* A stand-in for the brand's own storefront: a real host page that loads the
   real loader script exactly the way a brand would. This is the page the widget
   gets demonstrated from, and the page that catches every integration bug the
   embed route on its own cannot — origin checks, postMessage, the cart bridge. */

export default async function DemoPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const tenant = await getActiveTenant(slug);
  if (!tenant) notFound();

  const snippet = `<script src="https://widget.rovena.ai/rovena.js" data-tenant="${slug}" defer></script>`;

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "64px 24px",
        maxWidth: 880,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#16130f",
      }}
    >
      <p style={{ letterSpacing: "0.16em", fontSize: 11, textTransform: "uppercase", color: "#8a7f72" }}>
        Demo mağaza · {tenant.name}
      </p>
      <h1 style={{ fontSize: 34, margin: "10px 0 8px", fontWeight: 500, lineHeight: 1.2 }}>
        Bu sayfa {tenant.name} sitesinin yerine geçiyor.
      </h1>
      <p style={{ fontSize: 16, lineHeight: 1.6, color: "#4a4239", maxWidth: 620 }}>
        Sağ alttaki düğme, markanın sitesine eklenen tek satırlık script ile geliyor.
        Sayfanın geri kalanına dokunulmuyor: widget kendi çerçevesinde çalışıyor,
        sitenin CSS&apos;ini ve sepetini etkilemiyor.
      </p>

      <pre
        style={{
          marginTop: 28, padding: 16, borderRadius: 10, background: "#f5f2ed",
          border: "1px solid #e4ded4", overflowX: "auto", fontSize: 13,
        }}
      >
        <code>{snippet}</code>
      </pre>

      <h2
        style={{
          fontSize: 13, marginTop: 40, letterSpacing: "0.1em",
          textTransform: "uppercase", color: "#8a7f72", fontWeight: 600,
        }}
      >
        Derin entegrasyon
      </h2>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#4a4239", maxWidth: 620 }}>
        Ürün sayfasında bu düğmeler sitenin kendi JavaScript&apos;inden çağrılır —
        danışman hangi ürüne bakıldığını bilerek açılır.
      </p>
      <DemoActions />

      <Script id="rovena-loader" src="/rovena.js" data-tenant={slug} strategy="afterInteractive" />
    </main>
  );
}
