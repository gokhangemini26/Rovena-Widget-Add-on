import Script from "next/script";
import { notFound } from "next/navigation";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { DemoStorefront } from "@/components/DemoStorefront";

export const dynamic = "force-dynamic";

/* A full stand-in for the brand's live storefront:
   Shows the brand's live catalog, cart count, interactive product cards,
   and deep AI Assistant integration (scrolling to products on the site & automatic cart bridge). */

export default async function DemoPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const tenant = await getActiveTenant(slug);
  if (!tenant) notFound();

  const catalog = await getCatalog(tenant);
  const products = await catalog.getAll();

  return (
    <>
      <DemoStorefront tenant={tenant} products={products} />
      <Script id="rovena-loader" src="/rovena.js" data-tenant={slug} strategy="afterInteractive" />
    </>
  );
}
