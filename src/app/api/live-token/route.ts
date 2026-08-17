import { GoogleGenAI, Type, Modality } from "@google/genai";
import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { buildStaticPrompt } from "@/lib/ai/prompt";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const LIVE_MODEL = "gemini-3.1-flash-live-preview";

export async function OPTIONS(req: Request) {
  const origin = requestOrigin(req);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = requestOrigin(req);

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "voice_unconfigured" }, { status: 503, headers: corsHeaders(origin) });
    }

    const body = await req.json().catch(() => ({}));
    const slug = typeof body?.tenant === "string" ? body.tenant : "giovane-gentile";
    const tenant = await getActiveTenant(slug);
    if (!tenant) {
      return NextResponse.json({ error: "unknown_tenant" }, { status: 404, headers: corsHeaders(origin) });
    }

    if (!isAllowedOrigin(tenant, origin)) {
      return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers: corsHeaders(origin) });
    }

    const catalog = await getCatalog(tenant);
    const products = await catalog.getAll();

    const systemInstruction = buildStaticPrompt(tenant, products);

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    let tokenName = "";
    try {
      const now = Date.now();
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
          expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
          liveConnectConstraints: {
            model: LIVE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Aoede",
                  },
                },
              },
              systemInstruction: {
                parts: [{ text: systemInstruction }],
              },
            },
          },
          lockAdditionalFields: [],
        },
      });
      tokenName = token.name || "";
    } catch {
      // Ephemeral token creation not supported on some tiers; direct key fallback below
    }

    return NextResponse.json(
      {
        token: tokenName || undefined,
        apiKey: process.env.GEMINI_API_KEY || "",
        model: LIVE_MODEL,
        systemInstruction,
      },
      { headers: corsHeaders(origin) }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        apiKey: process.env.GEMINI_API_KEY,
        model: LIVE_MODEL,
        error: "token_failed",
        detail: msg.slice(0, 200),
      },
      { headers: corsHeaders(origin) }
    );
  }
}
