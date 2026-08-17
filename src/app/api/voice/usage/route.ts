import { after } from "next/server";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { logUsage } from "@/lib/metering/usage";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";

const LIVE_MODEL = "gemini-3.1-flash-live-preview";

/* POST /api/voice/usage — fire-and-forget beacon, sent once when a voice
   session ends. The Live API reports usageMetadata as a cumulative running
   total throughout the session (not per-chunk), so the client just forwards
   the LAST value it saw rather than summing anything itself. */

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin(req)) });
}

export async function POST(req: Request) {
  const origin = requestOrigin(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const slug = typeof body.tenant === "string" ? body.tenant : "";
  const tenant = await getActiveTenant(slug);
  if (!tenant || !isAllowedOrigin(tenant, origin)) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null;
  const usageMetadata = body.usageMetadata ?? null;

  after(() =>
    logUsage({
      tenantSlug: tenant.slug,
      sessionId,
      kind: "voice",
      model: LIVE_MODEL,
      usageMetadata,
      meta: { durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined },
    }),
  );

  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
