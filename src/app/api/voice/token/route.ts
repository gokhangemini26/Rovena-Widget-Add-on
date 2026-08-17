import { GoogleGenAI, Modality } from "@google/genai";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { buildVoiceSystemPrompt, buildTurnContext } from "@/lib/ai/prompt";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";
import { checkRate, clientIp } from "@/lib/security/ratelimit";
import type { Locale } from "@/lib/tenant/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/voice/token → { token, model }

   Mints a short-lived Gemini Live EPHEMERAL TOKEN with the system prompt,
   voice and modalities LOCKED server-side via liveConnectConstraints. The
   browser connects directly to Gemini's Live WebSocket with this token —
   never with GEMINI_API_KEY, and never able to see or override the prompt.

   No sign-in gate here (unlike the source product): a brand's storefront
   visitor is anonymous by design. The blast radius of an anonymous mint is
   bounded three ways instead: the origin allowlist (only the brand's own
   sites can request one), the same per-IP/session rate limiter chat uses, and
   the token's own short lifetimes below — a leaked token is worth at most one
   30-minute session, not standing access.
   ═══════════════════════════════════════════════════════════════════════════ */

const LIVE_MODEL = "gemini-3.1-flash-live-preview";
const TOKEN_START_WINDOW_MS = 2 * 60_000; // must open a session within 2 min
const TOKEN_SESSION_MS = 30 * 60_000; // session itself may run up to 30 min

function errorResponse(status: number, message: string, origin: string | null) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin(req)) });
}

export async function POST(req: Request) {
  const origin = requestOrigin(req);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, "invalid_json", origin);
  }

  const slug = typeof body.tenant === "string" ? body.tenant : "";
  const tenant = await getActiveTenant(slug);
  if (!tenant) return errorResponse(404, "unknown_tenant", origin);
  if (!isAllowedOrigin(tenant, origin)) return errorResponse(403, "origin_not_allowed", origin);
  if (!tenant.voice?.enabled) return errorResponse(404, "voice_not_enabled", origin);

  const sessionId = typeof body.sessionId === "string" && body.sessionId.length <= 64
    ? body.sessionId
    : "anonymous";

  // Same limiter as text chat, distinct key so a busy text conversation and a
  // voice attempt don't cannibalise each other's session quota.
  const verdict = checkRate({
    ip: clientIp(req),
    sessionId: `${tenant.slug}:voice:${sessionId}`,
    requestsPerMinute: tenant.limits.requestsPerMinute,
    messagesPerSession: tenant.limits.messagesPerSession,
  });
  if (!verdict.ok) return errorResponse(429, verdict.reason ?? "rate_limited", origin);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return errorResponse(503, "voice_unconfigured", origin);

  const locale: Locale = tenant.persona.locales.includes(body.locale as Locale)
    ? (body.locale as Locale)
    : tenant.persona.defaultLocale;

  const catalog = await getCatalog(tenant);
  const products = await catalog.getAll();
  if (!products.length) return errorResponse(503, "catalog_empty", origin);

  const turnContext = buildTurnContext({
    locale,
    currentSku: typeof body.currentSku === "string" ? body.currentSku : undefined,
    cartSkus: Array.isArray(body.cartSkus) ? (body.cartSkus as string[]).slice(0, 20) : undefined,
  });
  const systemInstruction = `${buildVoiceSystemPrompt(tenant, products)}\n\n${turnContext}`;

  try {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        newSessionExpireTime: new Date(now + TOKEN_START_WINDOW_MS).toISOString(),
        expireTime: new Date(now + TOKEN_SESSION_MS).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
            },
          },
        },
        // Everything NOT locked here (tools, transcription, VAD tuning) is
        // supplied by the client at connect time — the field mask rejects
        // `tools` inside the token, and none of those fields are sensitive
        // (tool names and skus are already public).
        lockAdditionalFields: [],
      },
    });

    return Response.json(
      { token: token.name, model: LIVE_MODEL },
      { headers: corsHeaders(origin) },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResponse(500, `token_failed: ${msg.slice(0, 160)}`, origin);
  }
}
