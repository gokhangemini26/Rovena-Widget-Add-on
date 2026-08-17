import type {
  Department,
  GarmentType,
  Product,
  ProductVariant,
  Season,
} from "@/lib/catalog/types";
import type { TenantFeed } from "@/lib/tenant/types";

/* ═══════════════════════════════════════════════════════════════════════════
   Feed → Product normalisation.

   Pure. No I/O, no database, no parser: `parseFeed` (parse.ts) turns bytes into
   plain objects, this file turns plain objects into Products. Keeping the two
   apart is what makes every rule below testable against a real brand's row
   without a network or a Supabase project.

   The design rule throughout: a field we cannot derive with confidence is left
   UNDEFINED rather than guessed. A wrong `garmentType` puts a jacket in the
   trousers slot of an outfit; a missing one only costs a styling nuance. The
   one exception is `department`, which is rejected outright — see below.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── path access ──────────────────────────────────────────────────────────── */

export function getPath(node: unknown, dotted: string): unknown {
  if (!dotted) return undefined;
  let cur: unknown = node;
  for (const key of dotted.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      // A repeated element parsed as an array — take the first, which is the
      // right behaviour for `<image>` repeated for galleries.
      cur = cur[0];
      if (cur === null || cur === undefined) return undefined;
    }
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // fast-xml-parser represents `<tag attr="x">text</tag>` as an object with a
  // text node key; accept the common spellings rather than forcing every brand
  // to flatten their XML for us.
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["#text", "_text", "value", "cdata"]) {
      if (typeof o[k] === "string") return String(o[k]).trim() || undefined;
    }
  }
  return undefined;
}

/** Read a mapped field: tenant `map` first, then `defaults`, then undefined. */
function field(
  node: unknown,
  feed: TenantFeed,
  name: string,
): string | undefined {
  const dotted = feed.map[name];
  const raw = dotted ? str(getPath(node, dotted)) : undefined;
  const value = raw ?? feed.defaults?.[name];
  if (value === undefined) return undefined;
  const translated = feed.valueMap?.[name]?.[value];
  return translated ?? value;
}

/* ── Turkish-aware matching ───────────────────────────────────────────────────

   Turkish is agglutinative and a brand's category field is written by a human,
   so the same garment arrives as "Ceket", "Erkek Ceketi", "Ceketler". A regex
   anchored with \b matches only the first: \b is ASCII-word based, so it both
   fails on the suffix AND misfires around ş/ğ/ı/ü/ö/ç.

   So: fold to ASCII, split into tokens, and match a token by PREFIX. Keywords
   shorter than four characters must match exactly — "mor", "bot", "şal" are
   common prefixes of unrelated words, and a wrong garment slot is worse than a
   missing one (see the file header). */

const TR_FOLD: Record<string, string> = {
  "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
  "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "â": "a", "î": "i", "û": "u",
};

export function foldTr(input: string): string {
  return input
    .replace(/[ıİşŞğĞüÜöÖçÇâîû]/g, (ch) => TR_FOLD[ch] ?? ch)
    .toLowerCase();
}

function tokens(input: string): string[] {
  return foldTr(input).split(/[^a-z0-9]+/).filter(Boolean);
}

const MIN_PREFIX_LENGTH = 4;

function matchesKeyword(token: string, keyword: string): boolean {
  return keyword.length < MIN_PREFIX_LENGTH
    ? token === keyword
    : token.startsWith(keyword);
}

/** True when any token of `text` matches any of `keywords`. Multi-word keywords
    ("kirik beyaz") are tested against the folded string instead. */
function hasAny(text: string, keywords: string[]): boolean {
  const folded = foldTr(text);
  const tk = tokens(text);
  return keywords.some((keyword) =>
    keyword.includes(" ")
      ? folded.includes(keyword)
      : tk.some((token) => matchesKeyword(token, keyword)),
  );
}

/* ── department ───────────────────────────────────────────────────────────── */

const DEPARTMENT_WORDS: Record<string, Department> = {
  kadin: "women", kadın: "women", women: "women", woman: "women",
  bayan: "women", k: "women", w: "women", f: "women", female: "women",
  erkek: "men", men: "men", man: "men", bay: "men", e: "men", m: "men",
  male: "men",
  unisex: "unisex", uni: "unisex", u: "unisex",
};

/** Department is the one field with no safe default.

    The source product proved why: gender used to be optional there and every
    reader fell back to "women", so a men's piece added without the tag silently
    joined the women's department and its outfit checks. Here an unresolvable
    department REJECTS the row. A product missing from the catalog is a gap the
    brand can see and fix; a product in the wrong department is an error the
    customer sees first. */
export function parseDepartment(raw: string | undefined): Department | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return DEPARTMENT_WORDS[key] ?? DEPARTMENT_WORDS[key.replace(/\s+/g, "")] ?? null;
}

/* ── garment type ─────────────────────────────────────────────────────────── */

const GARMENT_KEYWORDS: [GarmentType, string[]][] = [
  ["suit", ["takim", "suit", "smokin", "tuxedo"]],
  ["outerwear", ["mont", "kaban", "palto", "trenckot", "parka", "yelek", "coat", "jacket", "blazer", "ceket"]],
  ["top", ["gomlek", "tisort", "t-shirt", "kazak", "sweat", "hirka", "bluz", "polo", "shirt", "knit", "sweater", "triko"]],
  ["bottom", ["pantolon", "jean", "kot", "sort", "etek", "chino", "trouser", "skirt", "short"]],
  ["dress", ["elbise", "tulum", "dress", "jumpsuit"]],
  ["shoes", ["ayakkabi", "bot", "sneaker", "loafer", "mokasen", "cizme", "shoe", "boot", "derby", "oxford"]],
  ["bag", ["canta", "bag", "valiz", "clutch", "backpack"]],
  ["accessory", ["kemer", "kravat", "papyon", "atki", "sal", "eldiven", "sapka", "corap", "mendil", "belt", "tie", "scarf", "glove", "sock", "cufflink", "kol dugmesi"]],
];

/** Infer the outfit slot from the brand's own category and product name.

    Order matters twice over. "takım elbise" must not fall into the dress rule,
    so `suit` is tested first. And the CATEGORY is exhausted before the NAME is
    consulted at all: a name like "Ceket Yaka Elbise" describes a dress with a
    jacket collar, and reading the two fields in one pass would hang it in the
    wardrobe next to the blazers. */
export function inferGarmentType(
  category: string | undefined,
  name: string | undefined,
): GarmentType {
  for (const source of [category, name]) {
    if (!source) continue;
    for (const [type, keywords] of GARMENT_KEYWORDS) {
      if (hasAny(source, keywords)) return type;
    }
  }
  return "unknown";
}

/* ── colour ───────────────────────────────────────────────────────────────── */

/* Navy is its own family, not a shade of blue: a navy suit and a mid-blue shirt
   are a classic pairing, and collapsing them makes the harmony rules propose
   the one combination every menswear buyer would reject. */
const COLOR_KEYWORDS: [string, string[]][] = [
  ["black", ["siyah", "black", "antrasit", "komur"]],
  ["white", ["beyaz", "white", "ekru", "krem", "cream", "kirik beyaz", "off white", "off-white"]],
  ["grey", ["gri", "grey", "gray", "fume"]],
  ["navy", ["lacivert", "navy", "petrol", "indigo"]],
  ["blue", ["mavi", "blue", "turkuaz", "turquoise"]],
  ["brown", ["kahve", "brown", "taba", "camel", "bej", "beige", "vizon", "deve tuyu"]],
  ["green", ["yesil", "green", "haki", "khaki", "zeytin", "olive"]],
  ["red", ["kirmizi", "red", "bordo", "burgundy", "bordeaux", "visne"]],
  ["pink", ["pembe", "pink", "somon", "salmon", "fusya"]],
  ["purple", ["mor", "purple", "lila", "lavanta", "violet"]],
  ["yellow", ["sari", "yellow", "hardal", "mustard", "altin", "gold"]],
  ["orange", ["turuncu", "orange", "mercan", "coral"]],
];

export function colorFamilyOf(color: string | undefined): string | undefined {
  if (!color) return undefined;
  for (const [family, keywords] of COLOR_KEYWORDS) {
    if (hasAny(color, keywords)) return family;
  }
  return undefined;
}

/* ── fabric ───────────────────────────────────────────────────────────────── */

/** Parse "%70 Pamuk %30 Keten" / "70% cotton, 30% linen" / "Cotton 100%".

    Percentages are what let the model answer "is this warm enough for
    November" without a season tag, so a composition string that parses to
    nothing is worth surfacing in the feed report rather than swallowing. */
export function parseFabrics(
  composition: string | undefined,
): { name: string; percentage: number }[] {
  if (!composition) return [];
  const out: { name: string; percentage: number }[] = [];
  const seen = new Set<string>();

  // "%70 Pamuk" (percent first) and "Pamuk %70" / "Cotton 70%" (percent last).
  const patterns = [
    /%\s*(\d{1,3})\s*([\p{L}\s]+?)(?=(?:[,;/]|%\s*\d|$))/gu,
    /([\p{L}][\p{L}\s]*?)\s*[:\-]?\s*(\d{1,3})\s*%/gu,
  ];

  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i];
    let m: RegExpExecArray | null;
    while ((m = re.exec(composition)) !== null) {
      const pct = Number(i === 0 ? m[1] : m[2]);
      const name = (i === 0 ? m[2] : m[1]).trim().toLowerCase();
      if (!name || !Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, percentage: pct });
    }
    if (out.length) break;
  }
  return out;
}

/* ── season ───────────────────────────────────────────────────────────────── */

const ALL_SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
const SEASON_WORDS: Record<string, Season[]> = {
  ilkbahar: ["spring"], spring: ["spring"],
  yaz: ["summer"], summer: ["summer"], ss: ["spring", "summer"],
  sonbahar: ["autumn"], autumn: ["autumn"], fall: ["autumn"],
  kis: ["winter"], kış: ["winter"], winter: ["winter"],
  aw: ["autumn", "winter"], fw: ["autumn", "winter"],
  "4 mevsim": ALL_SEASONS, tum: ALL_SEASONS, tüm: ALL_SEASONS, all: ALL_SEASONS,
};

export function parseSeasons(raw: string | undefined): Season[] {
  if (!raw) return [];
  const key = raw.trim().toLowerCase();
  if (SEASON_WORDS[key]) return SEASON_WORDS[key];
  const found = new Set<Season>();
  for (const [word, seasons] of Object.entries(SEASON_WORDS)) {
    if (key.includes(word)) seasons.forEach((s) => found.add(s));
  }
  return [...found];
}

/* ── price ────────────────────────────────────────────────────────────────── */

/** Parse a price into integer minor units.

    Turkish feeds write "12.900,00" and international ones "12,900.00"; the same
    string means a 1000× different number depending on which. The separator that
    appears LAST is the decimal one — that single rule resolves both without a
    per-tenant setting. Floats are never used: 12900.00 * 100 is 1289999.99…
    in binary, and a catalog that misprices by a kuruş is a catalog no
    merchandiser trusts again. */
export function parsePriceMinor(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let intPart = cleaned;
  let decPart = "";

  const sepIndex = Math.max(lastComma, lastDot);
  if (sepIndex !== -1) {
    const tail = cleaned.slice(sepIndex + 1);
    // A 1-2 digit tail is decimals; a 3-digit tail is a thousands group
    // ("12.900" is twelve thousand nine hundred, not 12.9).
    if (tail.length === 1 || tail.length === 2) {
      intPart = cleaned.slice(0, sepIndex);
      decPart = tail;
    }
  }

  const digits = intPart.replace(/[^\d]/g, "");
  if (!digits) return null;
  const minor = Number(digits) * 100 + Number(decPart.padEnd(2, "0"));
  return Number.isFinite(minor) ? minor : null;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  TRY: "₺", EUR: "€", USD: "$", GBP: "£",
};

export function formatPrice(minor: number, currency: string): string {
  const major = Math.floor(minor / 100);
  const cents = minor % 100;
  const grouped = major.toLocaleString("tr-TR");
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  return cents === 0
    ? `${grouped} ${symbol}`
    : `${grouped},${String(cents).padStart(2, "0")} ${symbol}`;
}

/* ── sizes ────────────────────────────────────────────────────────────────── */

/** Sizes arrive as "48,50,52", "48 | 50 | 52", an array, or per-variant nodes. */
export function parseSizes(raw: unknown): string[] {
  const values: string[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const s = str(v);
      if (s) values.push(s);
    }
  } else {
    const s = str(raw);
    if (s) values.push(...s.split(/[,;|/]/));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/* ── the whole row ────────────────────────────────────────────────────────── */

export interface NormalizeResult {
  product: Product | null;
  /** Why the row was rejected, or what was missing but tolerated. Surfaced in
      the feed report so the brand fixes its data instead of us patching it. */
  issues: string[];
  rejected: boolean;
}

const REQUIRED = ["sku", "name", "department", "price", "imageMain", "productUrl"] as const;

export function normalizeProduct(node: unknown, feed: TenantFeed): NormalizeResult {
  const issues: string[] = [];

  const sku = field(node, feed, "sku");
  const name = field(node, feed, "name");
  const department = parseDepartment(field(node, feed, "department"));
  const priceRaw = field(node, feed, "price");
  const priceMinor = parsePriceMinor(priceRaw);
  const imageMain = field(node, feed, "imageMain");
  const productUrl = field(node, feed, "productUrl");

  const missing: string[] = [];
  if (!sku) missing.push("sku");
  if (!name) missing.push("name");
  if (!department) missing.push("department");
  if (priceMinor === null) missing.push("price");
  if (!imageMain) missing.push("imageMain");
  if (!productUrl) missing.push("productUrl");

  if (missing.length) {
    return {
      product: null,
      rejected: true,
      issues: [
        `Zorunlu alan eksik veya okunamadı: ${missing.join(", ")}` +
          (sku ? ` (sku: ${sku})` : ""),
      ],
    };
  }

  const category = field(node, feed, "category") ?? "";
  const color = field(node, feed, "color");
  const composition = field(node, feed, "composition");
  const currency = field(node, feed, "currency") ?? "TRY";

  const sizePath = feed.map["sizes"];
  const sizes = parseSizes(sizePath ? getPath(node, sizePath) : undefined);
  if (!sizes.length) issues.push(`Beden bilgisi yok (sku: ${sku})`);

  const stockPath = feed.map["stock"];
  const stockRaw = stockPath ? Number(str(getPath(node, stockPath))) : NaN;
  const stock = Number.isFinite(stockRaw) ? stockRaw : null;
  // A single product-level stock number cannot be attributed to one size, so it
  // is spread across every variant rather than invented per size. Real per-size
  // stock arrives through the endpoint provider instead.
  const variants: ProductVariant[] = sizes.map((size) => ({ size, stock }));

  const garmentType = inferGarmentType(category, name);
  if (garmentType === "unknown") {
    issues.push(`Parça tipi çıkarılamadı, kombine girmeyecek (sku: ${sku})`);
  }

  const relatedRaw = feed.map["relatedSkus"]
    ? str(getPath(node, feed.map["relatedSkus"]))
    : undefined;

  const product: Product = {
    sku: sku!,
    name: name!,
    nameEn: field(node, feed, "nameEn"),
    department: department!,
    category,
    garmentType,
    color,
    colorFamily: colorFamilyOf(color),
    composition,
    fabrics: parseFabrics(composition),
    seasons: parseSeasons(field(node, feed, "season")),
    priceMinor: priceMinor!,
    currency,
    priceDisplay: formatPrice(priceMinor!, currency),
    sizeSystem: field(node, feed, "sizeSystem"),
    variants,
    imageMain: imageMain!,
    imageDetail: field(node, feed, "imageDetail"),
    imageModel: field(node, feed, "imageModel"),
    productUrl: productUrl!,
    description: field(node, feed, "description"),
    care: field(node, feed, "care"),
    relatedSkus: relatedRaw
      ? relatedRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
      : [],
  };

  return { product, issues, rejected: false };
}

export const REQUIRED_FIELDS = REQUIRED;
