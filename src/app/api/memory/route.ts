import { NextRequest, NextResponse } from "next/server";
import { getStyleDna, saveStyleDna, clearStyleDna } from "@/lib/memory/store";
import { corsHeaders, requestOrigin } from "@/lib/security/origin";

export async function OPTIONS(req: Request) {
  const origin = requestOrigin(req);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const { searchParams } = new URL(req.url);
  const tenant = searchParams.get("tenant") || "default";
  const email = searchParams.get("email") || "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ active: false, styleDna: null }, { headers: corsHeaders(origin) });
  }

  const dna = await getStyleDna(tenant, email);
  return NextResponse.json(
    { active: Boolean(dna?.consentGiven), styleDna: dna },
    { headers: corsHeaders(origin) }
  );
}

export async function POST(req: NextRequest) {
  const origin = requestOrigin(req);
  try {
    const body = await req.json();
    const { tenant = "default", email, consentGiven = false, preferences = {} } = body;

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { ok: false, error: "Geçersiz e-posta adresi." },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    if (!consentGiven) {
      // Guest mode requested or consent not granted
      return NextResponse.json(
        { ok: true, active: false, mode: "guest", message: "Misafir modu aktif. Hafıza kaydedilmiyor." },
        { headers: corsHeaders(origin) }
      );
    }

    const dna = await saveStyleDna(tenant, email, preferences, consentGiven);
    return NextResponse.json(
      { ok: true, active: true, styleDna: dna, message: "Stil hafızası başarıyla aktifleştirildi." },
      { headers: corsHeaders(origin) }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Sunucu hatası." },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const origin = requestOrigin(req);
  try {
    const body = await req.json();
    const { tenant = "default", email } = body;

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "E-posta belirtilmedi." },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    await clearStyleDna(tenant, email);
    return NextResponse.json(
      { ok: true, message: "Stil hafızanız KVKK kapsamında kalıcı olarak silindi. Artık misafir modundasınız." },
      { headers: corsHeaders(origin) }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Silme işlemi başarısız oldu." },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
