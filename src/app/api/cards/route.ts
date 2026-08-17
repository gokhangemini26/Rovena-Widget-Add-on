import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";

/* POST /api/cards → the display fields for a list of skus.

   The text chat route enriches showProducts server-side before streaming it,
   so it never needs this. Voice does: its tool calls arrive over the Live
   socket carrying skus only, and the read-tool endpoint deliberately returns
   the TRIMMED model-facing projection (no image, no URL — those cost tokens on
   every turn and the model never needs them). Without this endpoint a voice
   recommendation renders as cards with no photograph, which is most of what a
   product card is for.

   Read-only, tenant-scoped, origin-checked. Returns only what the widget puts
   on screen. */

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin(req)) });
}

export async function POST(req: Request) {
  const origin = requestOrigin(req);
  const body = (await req.json().catch(() => ({}))) as { tenant?: string; skus?: string[] };

  const tenant = await getActiveTenant(typeof body.tenant === "string" ? body.tenant : "");
  if (!tenant) return Response.json({ products: [] }, { status: 404, headers: corsHeaders(origin) });
  if (!isAllowedOrigin(tenant, origin)) {
    return Response.json({ products: [] }, { status: 403, headers: corsHeaders(origin) });
  }

  const skus = Array.isArray(body.skus) ? body.skus.map(String).slice(0, 12) : [];
  if (!skus.length) return Response.json({ products: [] }, { headers: corsHeaders(origin) });

  const catalog = await getCatalog(tenant);
  const found = await catalog.getManyBySku(skus);

  // Keep the requested order so an outfit still reads top-to-bottom.
  const products = skus
    .map((sku) => found.find((p) => p.sku === sku))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      price: p.priceDisplay,
      image: p.imageMain,
      url: p.productUrl,
      sizes: p.variants.map((v) => v.size),
      category: p.category,
    }));

  return Response.json({ products }, { headers: corsHeaders(origin) });
}
