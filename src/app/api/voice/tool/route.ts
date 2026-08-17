import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { READ_TOOLS, executeReadTool } from "@/lib/ai/tools";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";

/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/voice/tool → the read-tool resolver for an open Live session.

   The Live WebSocket runs CLIENT-SIDE (browser ↔ Gemini directly, for audio
   latency), but resolving searchProducts/getProducts/checkStock needs the
   catalog and inventory providers, which are server-only. So a tool call
   arriving over the socket makes one short-lived round-trip here, and the
   client sends the result back to Gemini itself via sendToolResponse.

   Same shape as the text route's tool execution — this file exists only
   because the caller is the browser instead of another server route.
   ═══════════════════════════════════════════════════════════════════════════ */

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin(req)) });
}

export async function POST(req: Request) {
  const origin = requestOrigin(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const slug = typeof body.tenant === "string" ? body.tenant : "";
  const tenant = await getActiveTenant(slug);
  if (!tenant) return Response.json({ error: "unknown_tenant" }, { status: 404, headers: corsHeaders(origin) });
  if (!isAllowedOrigin(tenant, origin)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403, headers: corsHeaders(origin) });
  }

  const name = typeof body.name === "string" ? body.name : "";
  if (!READ_TOOLS.has(name)) {
    return Response.json({ error: "not_a_read_tool" }, { status: 400, headers: corsHeaders(origin) });
  }

  const catalog = await getCatalog(tenant);
  const args = (body.args ?? {}) as Record<string, unknown>;
  const result = await executeReadTool(name, args, { tenant, catalog });
  return Response.json(result, { headers: corsHeaders(origin) });
}
