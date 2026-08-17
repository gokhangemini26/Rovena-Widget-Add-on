/* ═══════════════════════════════════════════════════════════════════════════
   Rovena Multi-Tenant Virtual Try-On (VTON) Engine
   Layering engine + prompt builder for styling AI on base human models.
   ═══════════════════════════════════════════════════════════════════════════ */

import type { Product } from "@/lib/catalog/types";

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

export function inferSlot(product: Product): VtonSlot {
  const cat = (product.category || "").toLowerCase();
  const type = (product.garmentType || "").toLowerCase();
  const name = (product.name || "").toLowerCase();

  const combined = `${cat} ${type} ${name}`;

  if (combined.includes("elbise") || combined.includes("dress")) return "dress";
  if (combined.includes("takım") || combined.includes("suit")) return "suit";
  if (combined.includes("kaban") || combined.includes("palto") || combined.includes("coat") || combined.includes("trench")) return "coat";
  if (combined.includes("ceket") || combined.includes("blazer") || combined.includes("jacket") || combined.includes("yelek")) return "jacket";
  if (combined.includes("kazak") || combined.includes("triko") || combined.includes("knit") || combined.includes("hırka") || combined.includes("cardigan")) return "knit";
  if (combined.includes("pantolon") || combined.includes("trousers") || combined.includes("jean") || combined.includes("şort") || combined.includes("shorts") || combined.includes("etek") || combined.includes("skirt")) return "bottom";
  if (combined.includes("ayakkabı") || combined.includes("loafer") || combined.includes("sneaker") || combined.includes("bot") || combined.includes("boot") || combined.includes("shoes") || combined.includes("oxford")) return "shoes";
  if (combined.includes("kemer") || combined.includes("belt")) return "belt";
  if (combined.includes("atkı") || combined.includes("eşarp") || combined.includes("fular") || combined.includes("scarf")) return "scarf";
  if (combined.includes("şapka") || combined.includes("hat") || combined.includes("cap")) return "hat";
  if (combined.includes("çanta") || combined.includes("bag") || combined.includes("clutch") || combined.includes("tote")) return "bag";
  if (combined.includes("gözlük") || combined.includes("sunglasses") || combined.includes("eyewear")) return "eyewear";

  return "top"; // default top (gömlek, tshirt, polo vs.)
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
