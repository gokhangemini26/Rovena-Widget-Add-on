import { NextResponse } from "next/server";
import { parseFeed } from "@/lib/feed/parse";
import { normalizeProduct } from "@/lib/feed/normalize";
import type { TenantFeed } from "@/lib/tenant/types";
import type { Product } from "@/lib/catalog/types";

export const runtime = "nodejs";

const FEED_TIMEOUT_MS = 25_000;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { feedUrl, rawFeed, feedConfig } = body as {
      feedUrl?: string;
      rawFeed?: string;
      feedConfig: TenantFeed;
    };

    if (!feedConfig) {
      return NextResponse.json({ error: "feedConfig eksik" }, { status: 400 });
    }

    let raw = rawFeed || "";

    if (!raw && feedUrl) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
      try {
        const res = await fetch(feedUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Rovena-Feed-Inspector/1.0",
            Accept: "application/xml, text/xml, application/json, */*",
          },
          cache: "no-store",
        });
        clearTimeout(timer);
        if (!res.ok) {
          return NextResponse.json({
            ok: false,
            error: `Feed adresine bağlanılamadı. HTTP Durum Kodu: ${res.status} (${res.statusText})`,
          });
        }
        raw = await res.text();
      } catch (err: unknown) {
        clearTimeout(timer);
        return NextResponse.json({
          ok: false,
          error: `Bağlantı hatası: ${err instanceof Error ? err.message : "Zaman aşımı veya erişim engeli"}`,
        });
      }
    }

    if (!raw.trim()) {
      return NextResponse.json({
        ok: false,
        error: "Feed verisi boş veya URL girilmedi.",
      });
    }

    // Parse the feed
    const parsed = parseFeed(raw, feedConfig);
    if (parsed.error) {
      return NextResponse.json({
        ok: false,
        error: `Parse Hatası: ${parsed.error}`,
        rawSnippet: raw.slice(0, 500),
      });
    }

    const totalItems = parsed.items.length;
    const sampleProducts: Product[] = [];
    const issues: string[] = [];
    let rejectedCount = 0;

    for (let i = 0; i < parsed.items.length; i++) {
      const node = parsed.items[i];
      const result = normalizeProduct(node, feedConfig);
      if (result.rejected || !result.product) {
        rejectedCount++;
        if (issues.length < 30) {
          issues.push(...result.issues);
        }
      } else {
        if (sampleProducts.length < 10) {
          sampleProducts.push(result.product);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      totalItems,
      validItems: totalItems - rejectedCount,
      rejectedCount,
      sampleProducts,
      issues: issues.slice(0, 20),
      detectedKeys: parsed.items[0] && typeof parsed.items[0] === "object" ? Object.keys(parsed.items[0]) : [],
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Beklenmeyen hata oluştu" },
      { status: 500 }
    );
  }
}
