/* ═══════════════════════════════════════════════════════════════════════════
   Rovena Multi-Tenant Virtual Try-On (VTON) Engine
   Layering engine + prompt builder for styling AI on base human models.
   ═══════════════════════════════════════════════════════════════════════════ */

import type { Product } from "@/lib/catalog/types";
import { foldTr } from "@/lib/feed/normalize";

export type VtonSlot =
  | "dress"
  | "suit"
  | "top"
  | "bottom"
  | "knit"
  | "jacket"
  | "coat"
  | "shoes"
  | "belt"
  | "scarf"
  | "bag"
  | "eyewear"
  | "jewelry"
  | "hat";

export const SLOT_ORDER: VtonSlot[] = [
  "dress",
  "suit",
  "top",
  "bottom",
  "knit",
  "jacket",
  "coat",
  "shoes",
  "belt",
  "scarf",
  "hat",
  "bag",
  "eyewear",
  "jewelry",
];

const CONFLICTS: Partial<Record<VtonSlot, VtonSlot[]>> = {
  dress: ["bottom", "top", "suit"],
  suit: ["bottom", "jacket", "dress", "knit"],
  bottom: ["dress", "suit"],
  top: ["dress"],
  knit: ["suit"],
  jacket: ["suit"],
};

/* Slot inference is FINER-GRAINED than Product.garmentType on purpose.
   garmentType answers "which outfit slot does the stylist reason about"
   (outerwear); dressing a figure needs to know a coat layers OVER a jacket,
   which layers over a knit. So garmentType narrows the search and the
   keywords resolve the layer within it.

   Matching folds Turkish to ASCII first. Plain `.toLowerCase()` is not enough:
   JS lowercases "AYAKKABI" to "ayakkabi" with a dotted i, which never matches
   a keyword written "ayakkabı" — a category field in caps would silently fall
   through to the default. */
const SLOT_KEYWORDS: [VtonSlot, string[]][] = [
  ["dress", ["elbise", "dress", "tulum", "jumpsuit"]],
  ["suit", ["takim", "suit", "smokin", "tuxedo"]],
  ["coat", ["kaban", "palto", "trenckot", "trench", "coat", "mont", "parka"]],
  ["jacket", ["ceket", "blazer", "jacket", "yelek"]],
  ["knit", ["kazak", "triko", "knit", "hirka", "cardigan", "sweater", "sweat"]],
  ["bottom", ["pantolon", "trouser", "jean", "kot", "sort", "short", "etek", "skirt", "chino"]],
  ["shoes", ["ayakkabi", "loafer", "sneaker", "bot", "boot", "shoe", "oxford", "derby", "mokasen", "cizme"]],
  ["belt", ["kemer", "belt"]],
  ["scarf", ["atki", "esarp", "fular", "sal", "scarf"]],
  ["hat", ["sapka", "hat", "cap", "bere"]],
  ["bag", ["canta", "bag", "clutch", "tote", "valiz"]],
  ["eyewear", ["gozluk", "sunglasses", "eyewear"]],
  ["jewelry", ["kolye", "yuzuk", "bileklik", "kupe", "jewel", "necklace", "bracelet"]],
];

/** garmentType → the slots worth testing, in order. Keeps a "gömlek"
    (garmentType "top") from ever being resolved as a coat by a stray word in
    its name. */
const SLOTS_BY_GARMENT_TYPE: Record<string, VtonSlot[]> = {
  dress: ["dress"],
  suit: ["suit"],
  outerwear: ["coat", "jacket", "knit"],
  top: ["knit", "top"],
  bottom: ["bottom"],
  shoes: ["shoes"],
  bag: ["bag"],
  accessory: ["belt", "scarf", "hat", "eyewear", "jewelry"],
};

export function inferSlot(product: Product): VtonSlot {
  const haystack = foldTr(`${product.category || ""} ${product.name || ""}`);
  const hit = (slot: VtonSlot) =>
    (SLOT_KEYWORDS.find(([s]) => s === slot)?.[1] ?? []).some((k) => haystack.includes(k));

  const candidates = SLOTS_BY_GARMENT_TYPE[product.garmentType ?? ""] ?? [];
  for (const slot of candidates) if (hit(slot)) return slot;
  // garmentType known but no keyword matched: trust the coarse classification
  // rather than scanning unrelated slots.
  if (candidates.length) return candidates[candidates.length - 1];

  // garmentType is "unknown" — fall back to a full keyword scan.
  for (const [slot, keywords] of SLOT_KEYWORDS) {
    if (keywords.some((k) => haystack.includes(k))) return slot;
  }
  return "top";
}

export interface TryOnWornItem {
  sku: string;
  slot: VtonSlot;
  desc: string;
  imageUrl: string;
  name: string;
  priceDisplay: string;
}

export interface TryOnOutfitPlan {
  gender: "women" | "men";
  worn: TryOnWornItem[];
  dropped: string[];
}

export function planTryOnOutfit(products: Product[], forcedGender?: "women" | "men"): TryOnOutfitPlan | null {
  if (!products.length) return null;

  const dropped: string[] = [];
  const occupied = new Set<VtonSlot>();
  const picked: TryOnWornItem[] = [];

  let detectedGender: "women" | "men" = forcedGender || "men";
  if (!forcedGender) {
    const womenCount = products.filter((p) => p.department === "women").length;
    const menCount = products.filter((p) => p.department === "men").length;
    detectedGender = womenCount > menCount ? "women" : "men";
  }

  for (const p of products) {
    const slot = inferSlot(p);
    const clash = (CONFLICTS[slot] || []).some((s) => occupied.has(s));

    if (occupied.has(slot) || clash) {
      dropped.push(p.sku);
      continue;
    }

    occupied.add(slot);
    const colorPart = p.color ? `${p.color} ` : "";
    const fabricPart = p.composition ? `(${p.composition}) ` : "";
    const desc = `${colorPart}${fabricPart}${p.name}`.trim();

    picked.push({
      sku: p.sku,
      slot,
      desc,
      imageUrl: p.imageMain,
      name: p.name,
      priceDisplay: p.priceDisplay,
    });
  }

  const worn = picked.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  if (!worn.length) return null;

  return {
    gender: detectedGender,
    worn,
    dropped,
  };
}

export function buildTryOnPrompt(plan: TryOnOutfitPlan, brandName: string): string {
  const genderDesc =
    plan.gender === "men"
      ? "a sophisticated, stylish man with refined grooming, standing naturally in an editorial luxury studio"
      : "an elegant, modern woman with polished hair and natural styling, standing in a warm editorial daylight setting";

  const wornList = plan.worn
    .map((w, idx) => `  ${idx + 1}. [${w.slot.toUpperCase()}]: ${w.desc}`)
    .join("\n");

  return `
You are a high-fashion luxury digital atelier. Create a photorealistic, full-body editorial fashion photograph of ${genderDesc}.

The person is wearing this exact tailored outfit from ${brandName}:
${wornList}

STRICT VISUAL & STYLING RULES:
1. PHOTOREALISM: Ultra-high quality 8K fashion editorial photography, natural skin texture, realistic fabric draping, authentic light reflections.
2. ACCURACY: Every garment listed above must be clearly visible, faithfully matching its color, material, silhouette and cut as shown in the reference garment images.
3. COMPOSITION: Full-body standing fashion lookbook pose, centered, elegant posture, feet and shoes completely visible on the ground.
4. FINISH: No artificial CGI plastic look, no warped limbs, no extra floating items. Cohesive color harmony.
`.trim();
}
