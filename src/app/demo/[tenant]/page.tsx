import Script from "next/script";
import { notFound } from "next/navigation";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { DemoStorefront } from "@/components/DemoStorefront";

export const dynamic = "force-dynamic";

/* A stand-in for the brand's own storefront, loading the real loader script the
   way a brand would.

   It is also the only place the HOST-side half of the product gets exercised:
   the cart callback bridge, the `data-rovena-section` / `data-rovena-sku`
   targets the stylist scrolls to, and the rovena:open-cart contract. The embed
   route on its own cannot test any of that, because none of it lives in the
   widget — which is the point of the iframe boundary. */

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
