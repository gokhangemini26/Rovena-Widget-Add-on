import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/products?tenant=<slug>&skus=A,B  — the same display fields as
   POST /api/cards, for callers that already had this GET shape wired up.

   DUPLICATE: /api/cards is the one the widget uses and the one to keep; this
   exists only so an existing caller does not 404. Prefer /api/cards for new
   work, and delete this once nothing points at it.

   Three things were wrong in the first version and are fixed here:
     · It mapped from `project()`, the deliberately TRIMMED model-facing
       projection, and read .title/.image/.url off it — fields that do not
       exist there, because they cost tokens on every turn and the model never
       needs them. It did not compile.
     · With no `skus` it returned the ENTIRE catalog. Any allowlisted origin
       could dump a brand's full price list in one request; the widget never
       needs more than the handful of skus it is about to render.
     · It defaulted the tenant to "giovane-gentile". A hardcoded tenant in a
       multi-tenant product is how one brand ends up served another's catalog. */

const MAX_SKUS = 12;

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin(req)) });
}

export async function GET(req: Request) {
  const origin = requestOrigin(req);
  const { searchParams } = new URL(req.url);

  const tenant = await getActiveTenant(searchParams.get("tenant") ?? "");
  if (!tenant) {
    return Response.json({ error: "unknown_tenant" }, { status: 404, headers: corsHeaders(origin) });
  }
  if (!isAllowedOrigin(tenant, origin)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403, headers: corsHeaders(origin) });
  }

  const skus = (searchParams.get("skus") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SKUS);

  if (!skus.length) {
    return Response.json(
      { products: [], error: "skus_required" },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const catalog = await getCatalog(tenant);
  const found = await catalog.getManyBySku(skus);

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
