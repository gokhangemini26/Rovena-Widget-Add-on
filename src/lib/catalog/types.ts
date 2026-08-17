/* ═══════════════════════════════════════════════════════════════════════════
   The normalised product model.

   Every brand's feed is different; everything above this file sees only this
   shape. The fields are the ones a styling decision actually depends on —
   deliberately shallow. Depth is added only where the model would otherwise
   have to guess (garmentType, colorFamily, fabric), which is the difference
   between a stylist and a search box.
   ═══════════════════════════════════════════════════════════════════════════ */

export type Department = "women" | "men" | "unisex";

/** Which layer of an outfit a piece occupies. The outfit builder reasons about
    slots, not category names, so "ceket"/"blazer"/"giacca" all collapse here. */
export type GarmentType =
  | "outerwear"
  | "top"
  | "bottom"
  | "dress"
  | "suit"
  | "shoes"
  | "bag"
  | "accessory"
  | "unknown";

export type Season = "spring" | "summer" | "autumn" | "winter";

export interface ProductVariant {
  size: string;
  /** null when the brand sends no stock at all — distinct from 0. */
  stock: number | null;
}

export interface Product {
  /** The brand's own immutable identifier. Also the AI-facing handle: the model
      only ever names products by sku, which is what makes a hallucinated
      product detectable rather than plausible. */
  sku: string;
  name: string;
  nameEn?: string;
  department: Department;
  /** The brand's own category label, kept verbatim for display and filtering. */
  category: string;
  garmentType: GarmentType;
  /** Canonical colour name in Turkish, as the brand writes it. */
  color?: string;
  /** Coarse colour bucket used for harmony rules. */
  colorFamily?: string;
  /** Raw composition string, e.g. "%70 pamuk %30 keten". */
  composition?: string;
  /** Parsed from composition; drives "yazlık bir şey" style questions. */
  fabrics: { name: string; percentage: number }[];
  seasons: Season[];
  priceMinor: number;
  currency: string;
  priceDisplay: string;
  sizeSystem?: string;
  variants: ProductVariant[];
  imageMain: string;
  imageDetail?: string;
  imageModel?: string;
  productUrl: string;
  description?: string;
  care?: string;
  /** The brand's own cross-sell picks. Seeds the compatibility graph — the
      single highest-value optional field in a feed. */
  relatedSkus: string[];
}

/** What the model is shown. Stories, care text and image URLs are stripped:
    they cost tokens on every turn and the model never needs to reproduce them
    verbatim. */
export interface ProductProjection {
  sku: string;
  name: string;
  department: Department;
  category: string;
  garmentType: GarmentType;
  color?: string;
  fabric?: string;
  seasons: Season[];
  price: string;
  sizes: string[];
}

export function project(p: Product): ProductProjection {
  return {
    sku: p.sku,
    name: p.name,
    department: p.department,
    category: p.category,
    garmentType: p.garmentType,
    color: p.color,
    fabric: p.composition,
    seasons: p.seasons,
    price: p.priceDisplay,
    sizes: p.variants.map((v) => v.size),
  };
}
