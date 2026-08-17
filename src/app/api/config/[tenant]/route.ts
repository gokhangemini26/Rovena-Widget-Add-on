import { getActiveTenant } from "@/lib/tenant/resolve";
import { toPublicConfig } from "@/lib/tenant/types";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/config/<tenant> — what the loader script needs before it can paint
   anything: colours, launcher position, greeting. Returns the PUBLIC subset
   only; feed URLs, stock credentials and limits never leave the server. */

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin(req)) });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const origin = requestOrigin(req);
  const { tenant: slug } = await params;
  const tenant = await getActiveTenant(slug);

  if (!tenant) {
    return Response.json({ error: "unknown_tenant" }, { status: 404, headers: corsHeaders(origin) });
  }
  if (!isAllowedOrigin(tenant, origin)) {
    // Deliberately explicit: the brand's own developer pasting the snippet on a
    // staging domain gets a message they can act on rather than a blank widget.
    return Response.json(
      { error: "origin_not_allowed", origin },
      { status: 403, headers: corsHeaders(origin) },
    );
  }

  return Response.json(toPublicConfig(tenant), {
    headers: { ...corsHeaders(origin), "cache-control": "public, max-age=60" },
  });
}
