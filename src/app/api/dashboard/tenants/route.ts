import { NextResponse } from "next/server";
import { listAllTenants, getTenant, saveTenant } from "@/lib/tenant/resolve";
import type { Tenant } from "@/lib/tenant/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");

  if (slug) {
    const tenant = await getTenant(slug);
    if (!tenant) {
      return NextResponse.json({ error: "Tenant bulunamadı" }, { status: 404 });
    }
    return NextResponse.json({ tenant });
  }

  const tenants = await listAllTenants();
  return NextResponse.json({ tenants });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Tenant;
    if (!body || !body.slug || !body.name) {
      return NextResponse.json(
        { error: "Zorunlu alanlar eksik: slug ve name gereklidir." },
        { status: 400 }
      );
    }

    const result = await saveTenant(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Kayıt başarısız" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, tenant: body });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sunucu hatası" },
      { status: 500 }
    );
  }
}
