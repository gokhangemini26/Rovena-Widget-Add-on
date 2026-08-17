import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { planTryOnOutfit, buildTryOnPrompt } from "@/lib/vton";
import type { Product, GarmentType } from "@/lib/catalog/types";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 120;

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) {
      const base64Data = url.split(",")[1];
      return Buffer.from(base64Data, "base64");
    }
    const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "Rovena-VTON/1.0" } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "GEMINI_API_KEY yapılandırılmamış" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { tenant: slug, skus, products: customProducts } = body as {
      tenant: string;
      skus?: string[];
      products?: Array<{ sku: string; name: string; price: string; image: string; category?: string }>;
    };

    if (!slug) {
      return NextResponse.json({ ok: false, error: "tenant parametresi eksik" }, { status: 400 });
    }

    const tenant = await getTenant(slug);
    if (!tenant) {
      return NextResponse.json({ ok: false, error: "Tenant bulunamadı" }, { status: 404 });
    }

    let resolvedProducts: Product[] = [];

    // 1. Resolve from Catalog if skus provided
    if (Array.isArray(skus) && skus.length > 0) {
      const catalogProvider = await getCatalog(tenant);
      const catalog = await catalogProvider.getAll();
      const skuSet = new Set(skus);
      resolvedProducts = catalog.filter((p: Product) => skuSet.has(p.sku));
    }

    // 2. Fallback to passed products if catalog lookup yielded empty
    if (!resolvedProducts.length && Array.isArray(customProducts) && customProducts.length > 0) {
      resolvedProducts = customProducts.map((cp) => ({
        sku: cp.sku,
        name: cp.name,
        priceDisplay: cp.price,
        imageMain: cp.image,
        category: cp.category || "Giyim",
        department: (tenant.feed.defaults?.department as "men" | "women") || "men",
        garmentType: "unknown" as GarmentType,
        fabrics: [],
        seasons: ["spring", "summer", "autumn", "winter"],
        priceMinor: 0,
        currency: "TRY",
        variants: [],
        productUrl: "",
        relatedSkus: [],
      }));
    }

    if (!resolvedProducts.length) {
      return NextResponse.json(
        { ok: false, error: "Manken üstünde denenecek geçerli parça bulunamadı." },
        { status: 400 }
      );
    }

    // Plan outfit
    const defaultGender = (tenant.feed.defaults?.department as "men" | "women") || "men";
    const plan = planTryOnOutfit(resolvedProducts, defaultGender);
    if (!plan || !plan.worn.length) {
      return NextResponse.json(
        { ok: false, error: "Kombin parçaları giydirme slotlarıyla eşleştirilemedi." },
        { status: 400 }
      );
    }

    // Load Base Model Image from public directory
    let baseModelBuffer: Buffer | null = null;
    try {
      const modelPath = path.join(
        process.cwd(),
        "public",
        "images",
        "models",
        `vton-model-${plan.gender}.png`
      );
      baseModelBuffer = await fs.readFile(modelPath);
    } catch (e) {
      console.warn("Base model image not found on disk, continuing with pure generation:", e);
    }

    // Fetch Garment Images in parallel
    const garmentImageBuffers = await Promise.all(
      plan.worn.map((w) => fetchImageBuffer(w.imageUrl))
    );

    const prompt = buildTryOnPrompt(plan, tenant.name);

    // Build Gemini multimodal parts
    const ai = new GoogleGenAI({ apiKey });
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (baseModelBuffer) {
      parts.push({
        text: "Reference Photo 1: Base Human Model & Pose. Use this exact human anatomy, pose and background style:",
      });
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: baseModelBuffer.toString("base64"),
        },
      });
    }

    plan.worn.forEach((w, idx) => {
      const buf = garmentImageBuffers[idx];
      if (buf) {
        parts.push({
          text: `Garment Item ${idx + 1} (${w.slot}): ${w.desc}. Take this exact fabric, cut and color:`,
        });
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: buf.toString("base64"),
          },
        });
      }
    });

    parts.push({ text: prompt });

    // Call Gemini 3.1 Flash Lite Image
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-image",
      contents: parts,
      config: {
        responseModalities: ["IMAGE", "TEXT"],
      },
    });

    let generatedImageBase64: string | null = null;
    const candidates = response.candidates || [];
    if (candidates[0]?.content?.parts) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData?.data) {
          generatedImageBase64 = `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!generatedImageBase64) {
      return NextResponse.json({
        ok: false,
        error: "Görsel üretim modeli geçerli bir çıktı üretemedi.",
        durationMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json({
      ok: true,
      imageUrl: generatedImageBase64,
      gender: plan.gender,
      worn: plan.worn,
      dropped: plan.dropped,
      durationMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    console.error("VTON Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Manken giydirme sırasında bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}
