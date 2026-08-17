import { after } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { planTryOnOutfit, buildTryOnPrompt } from "@/lib/vton";
import { logUsage } from "@/lib/metering/usage";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";
import { checkRate, clientIp } from "@/lib/security/ratelimit";
import type { Product } from "@/lib/catalog/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/tryon → { ok, imageUrl, worn, dropped }

   Dresses the outfit currently on screen on the brand's reference model.
   The most expensive call in the product (image output is billed per image,
   not per token), so it is gated the same way everything else is — tenant
   must have tryOn.enabled, origin must be allowlisted, rate limit applies —
   and the result is metered.

   The garment images are the whole point: without them the model invents a
   navy suit rather than rendering THIS navy suit. Two things that broke that
   in the first version and are fixed here:

     · Relative image URLs. A catalog straight out of a feed may carry
       "/media/x.jpg"; server-side `fetch` has no notion of a current page, so
       every such fetch threw, was swallowed by the catch, and the render
       silently proceeded on the text prompt alone — looking like a bad model
       rather than a missing input. They are now resolved against the tenant's
       own origin, and a failure is REPORTED instead of hidden.
     · Hardcoded image/png. The bytes' real type is sniffed from their magic
       number; anything Gemini cannot read as an image (SVG placeholders, an
       HTML error page served with a 200) is skipped with a reason.
   ═══════════════════════════════════════════════════════════════════════════ */

const VTON_MODEL = "gemini-3.1-flash-lite-image";
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
const MAX_GARMENT_BYTES = 6 * 1024 * 1024;

interface LoadedImage {
  mimeType: string;
  base64: string;
}

/** Sniff a real raster type from the leading bytes. A feed's `.jpg` URL that
    actually serves an SVG, or a CDN that returns an HTML error page with a
    200, both look fine by extension and fail inside the model. */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buf.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "image/gif";
  return null;
}

async function loadImage(
  rawUrl: string,
  baseOrigin: string,
): Promise<{ image?: LoadedImage; error?: string }> {
  if (!rawUrl) return { error: "görsel adresi yok" };

  if (rawUrl.startsWith("data:")) {
    const comma = rawUrl.indexOf(",");
    const buf = Buffer.from(rawUrl.slice(comma + 1), "base64");
    const mime = sniffImageMime(buf);
    return mime ? { image: { mimeType: mime, base64: buf.toString("base64") } } : { error: "data URI raster görsel değil" };
  }

  let url: URL;
  try {
    // A feed field is frequently a site-relative path. Resolving it against
    // the deployment origin is what makes the local demo work at all and what
    // makes a brand's own relative CDN paths work in production.
    url = new URL(rawUrl, baseOrigin);
  } catch {
    return { error: `geçersiz görsel adresi: ${rawUrl.slice(0, 80)}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "user-agent": "Rovena-VTON/1.0", accept: "image/*" },
    });
    if (!res.ok) return { error: `görsel ${res.status} döndü: ${url.pathname}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_GARMENT_BYTES) return { error: `görsel çok büyük: ${url.pathname}` };
    const mime = sniffImageMime(buf);
    if (!mime) {
      return {
        error:
          `görsel okunamadı (JPEG/PNG/WebP değil): ${url.pathname}` +
          ` — SVG ve vektör görseller giydirmede kullanılamaz`,
      };
    }
    return { image: { mimeType: mime, base64: buf.toString("base64") } };
  } catch (e) {
    return {
      error: `görsel indirilemedi: ${url.pathname} (${e instanceof Error ? e.message : "bilinmeyen"})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The house model. A path is read off disk (no self-fetch, which would
    deadlock a single-instance dev server); an absolute URL is fetched. */
async function loadReferenceModel(
  ref: string | undefined,
  baseOrigin: string,
): Promise<{ image?: LoadedImage; error?: string }> {
  if (!ref) return { error: "referans manken tanımlı değil" };
  if (/^https?:\/\//i.test(ref)) return loadImage(ref, baseOrigin);
  try {
    const buf = await fs.readFile(path.join(process.cwd(), "public", ref.replace(/^\/+/, "")));
    const mime = sniffImageMime(buf);
    return mime
      ? { image: { mimeType: mime, base64: buf.toString("base64") } }
      : { error: `referans manken raster görsel değil: ${ref}` };
  } catch {
    return { error: `referans manken bulunamadı: ${ref}` };
  }
}

function json(body: unknown, status: number, origin: string | null) {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin(req)) });
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const origin = requestOrigin(req);

  const body = (await req.json().catch(() => ({}))) as {
    tenant?: string;
    sessionId?: string;
    skus?: string[];
  };

  const slug = typeof body.tenant === "string" ? body.tenant : "";
  const tenant = await getActiveTenant(slug);
  if (!tenant) return json({ ok: false, error: "unknown_tenant" }, 404, origin);
  if (!isAllowedOrigin(tenant, origin)) return json({ ok: false, error: "origin_not_allowed" }, 403, origin);
  if (!tenant.tryOn?.enabled) return json({ ok: false, error: "tryon_not_enabled" }, 404, origin);

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : "anonymous";
  const verdict = checkRate({
    ip: clientIp(req),
    // Its own bucket: one image costs far more than one message, and a
    // customer hammering the try-on button must not also lock them out of
    // the conversation.
    sessionId: `${tenant.slug}:tryon:${sessionId}`,
    requestsPerMinute: Math.max(2, Math.floor(tenant.limits.requestsPerMinute / 4)),
    messagesPerSession: Math.max(3, Math.floor(tenant.limits.messagesPerSession / 4)),
  });
  if (!verdict.ok) return json({ ok: false, error: "rate_limited" }, 429, origin);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ ok: false, error: "tryon_unconfigured" }, 503, origin);

  const skus = Array.isArray(body.skus) ? body.skus.map(String).slice(0, 8) : [];
  if (!skus.length) return json({ ok: false, error: "no_skus" }, 400, origin);

  const catalog = await getCatalog(tenant);
  const found = await catalog.getManyBySku(skus);
  if (!found.length) return json({ ok: false, error: "skus_not_in_catalog" }, 400, origin);

  // Keep the model's requested order; the layering planner re-sorts by slot.
  const ordered: Product[] = skus
    .map((sku) => found.find((p) => p.sku === sku))
    .filter((p): p is Product => Boolean(p));

  const plan = planTryOnOutfit(ordered);
  if (!plan || !plan.worn.length) {
    return json({ ok: false, error: "outfit_not_plannable" }, 400, origin);
  }

  const baseOrigin =
    process.env.NEXT_PUBLIC_WIDGET_ORIGIN || new URL(req.url).origin;

  const issues: string[] = [];

  const modelRef = plan.gender === "women" ? tenant.tryOn.models?.women : tenant.tryOn.models?.men;
  const modelResult = await loadReferenceModel(modelRef, baseOrigin);
  if (modelResult.error) issues.push(`Referans manken: ${modelResult.error}`);

  const garmentResults = await Promise.all(
    plan.worn.map(async (w) => ({ worn: w, ...(await loadImage(w.imageUrl, baseOrigin)) })),
  );
  for (const g of garmentResults) {
    if (g.error) issues.push(`${g.worn.sku}: ${g.error}`);
  }
  const withImages = garmentResults.filter((g) => g.image);

  // Refuse rather than render a plausible lie. With no garment image at all
  // the model invents clothes that merely match the text description, and the
  // customer is shown a garment the brand does not sell — the try-on
  // equivalent of claiming stock we cannot see.
  if (!withImages.length) {
    return json(
      {
        ok: false,
        error: "no_garment_images",
        message:
          "Bu parçaların görselleri giydirme için okunamadı, o yüzden manken görseli üretilmedi.",
        issues,
      },
      200,
      origin,
    );
  }

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  if (modelResult.image) {
    parts.push({
      text: "Reference Photo 1 — THE MODEL AND THE SCENE. The person, the face, the background and the light in the finished picture all come from this photograph and from nowhere else:",
    });
    parts.push({ inlineData: { mimeType: modelResult.image.mimeType, data: modelResult.image.base64 } });
  }

  withImages.forEach((g, i) => {
    parts.push({
      text: `Garment ${i + 1} — [${g.worn.slot.toUpperCase()}] ${g.worn.desc}. Reproduce this exact colour, fabric and cut:`,
    });
    parts.push({ inlineData: { mimeType: g.image!.mimeType, data: g.image!.base64 } });
  });

  parts.push({
    text: buildTryOnPrompt(
      { ...plan, worn: withImages.map((g) => g.worn) },
      tenant.name,
    ),
  });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: VTON_MODEL,
      contents: parts,
      config: { responseModalities: ["IMAGE", "TEXT"] },
    });

    let imageUrl: string | null = null;
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        imageUrl = `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
        break;
      }
    }

    after(() =>
      logUsage({
        tenantSlug: tenant.slug,
        sessionId,
        kind: "image",
        model: VTON_MODEL,
        usageMetadata: response.usageMetadata,
        meta: { skus: withImages.map((g) => g.worn.sku), gender: plan.gender },
      }),
    );

    if (!imageUrl) {
      return json({ ok: false, error: "no_image_returned", issues }, 200, origin);
    }

    return json(
      {
        ok: true,
        imageUrl,
        gender: plan.gender,
        worn: withImages.map((g) => g.worn),
        dropped: plan.dropped,
        issues,
        durationMs: Date.now() - startedAt,
      },
      200,
      origin,
    );
  } catch (e) {
    console.error("[tryon]", tenant.slug, e instanceof Error ? e.message : e);
    return json({ ok: false, error: "render_failed", issues }, 200, origin);
  }
}
