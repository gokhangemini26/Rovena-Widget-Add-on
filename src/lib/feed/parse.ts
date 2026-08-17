import { XMLParser } from "fast-xml-parser";
import { getPath } from "./normalize";
import type { TenantFeed } from "@/lib/tenant/types";

/* Bytes → plain objects. The only file in the feed pipeline that knows a
   format exists; normalize.ts sees the same shape either way. */

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false, // keep "0480" a string — SKUs and sizes lose leading zeros otherwise
  parseAttributeValue: false,
  cdataPropName: "cdata",
});

export interface ParsedFeed {
  items: unknown[];
  error?: string;
}

/** Extract the product array from a parsed document.

    `itemPath` is the tenant's dotted path to the repeating node. When it points
    at a single object (a feed with exactly one product, which happens on a
    brand's staging environment) it is wrapped, so a one-product feed doesn't
    silently import zero. */
export function selectItems(doc: unknown, itemPath: string): unknown[] {
  const node = itemPath ? getPath(doc, itemPath) : doc;
  if (Array.isArray(node)) return node;
  if (node && typeof node === "object") return [node];
  return [];
}

export function parseFeed(body: string, feed: TenantFeed): ParsedFeed {
  try {
    const doc = feed.format === "xml" ? xml.parse(body) : JSON.parse(body);
    const items = selectItems(doc, feed.itemPath);
    if (!items.length) {
      return {
        items: [],
        error:
          `Feed okundu ama "${feed.itemPath}" yolunda ürün bulunamadı. ` +
          `Kök elemanlar: ${Object.keys((doc ?? {}) as object).slice(0, 8).join(", ")}`,
      };
    }
    return { items };
  } catch (e) {
    return {
      items: [],
      error: `Feed ayrıştırılamadı (${feed.format}): ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}
