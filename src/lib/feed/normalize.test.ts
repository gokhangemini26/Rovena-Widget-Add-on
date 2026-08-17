import { describe, it, expect } from "vitest";
import {
  colorFamilyOf,
  formatPrice,
  getPath,
  inferGarmentType,
  normalizeProduct,
  parseDepartment,
  parseFabrics,
  parsePriceMinor,
  parseSeasons,
  parseSizes,
} from "./normalize";
import { selectItems } from "./parse";
import type { TenantFeed } from "@/lib/tenant/types";

const feed: TenantFeed = {
  url: null,
  format: "xml",
  itemPath: "Products.Product",
  refreshHours: 4,
  map: {
    sku: "StokKodu",
    name: "UrunAdi",
    department: "Cinsiyet",
    category: "Kategori",
    color: "Renk",
    composition: "Kumas",
    price: "SatisFiyat",
    currency: "ParaBirimi",
    sizes: "Bedenler",
    stock: "Stok",
    imageMain: "Resim",
    productUrl: "Link",
    season: "Sezon",
    relatedSkus: "Kombin",
  },
};

const row = {
  StokKodu: "GG-CT-0412",
  UrunAdi: "Yünlü Çift Düğmeli Ceket",
  Cinsiyet: "Erkek",
  Kategori: "Ceket",
  Renk: "Lacivert",
  Kumas: "%70 Yün %30 Polyester",
  SatisFiyat: "12.900,00",
  ParaBirimi: "TRY",
  Bedenler: "48,50,52,54",
  Stok: "7",
  Resim: "https://cdn.example.com/gg-ct-0412.jpg",
  Link: "https://example.com/p/gg-ct-0412",
  Sezon: "Sonbahar",
  Kombin: "GG-PT-0311, GG-SH-0102",
};

describe("getPath", () => {
  it("walks dotted paths and unwraps repeated nodes", () => {
    expect(getPath({ a: { b: "x" } }, "a.b")).toBe("x");
    expect(getPath({ a: [{ b: "first" }, { b: "second" }] }, "a.b")).toBe("first");
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
    expect(getPath({}, "")).toBeUndefined();
  });
});

describe("parseDepartment", () => {
  it("maps the spellings a Turkish feed actually uses", () => {
    expect(parseDepartment("Erkek")).toBe("men");
    expect(parseDepartment("KADIN")).toBe("women");
    expect(parseDepartment("Unisex")).toBe("unisex");
    expect(parseDepartment("E")).toBe("men");
  });

  it("returns null rather than guessing — the whole point of the field", () => {
    expect(parseDepartment(undefined)).toBeNull();
    expect(parseDepartment("")).toBeNull();
    expect(parseDepartment("Çocuk")).toBeNull();
  });
});

describe("inferGarmentType", () => {
  it("reads the brand's own category first", () => {
    expect(inferGarmentType("Ceket", "Yünlü Ceket")).toBe("outerwear");
    expect(inferGarmentType("Pantolon", "Chino Pantolon")).toBe("bottom");
    expect(inferGarmentType("Ayakkabı", "Deri Loafer")).toBe("shoes");
    expect(inferGarmentType("Gömlek", "Oxford Gömlek")).toBe("top");
  });

  it("keeps 'takım elbise' a suit instead of a dress", () => {
    expect(inferGarmentType("Takım Elbise", "Slim Fit Takım")).toBe("suit");
  });

  it("survives Turkish suffixes — the way a human writes a category field", () => {
    // A \b-anchored regex matches "Ceket" and misses every inflected form,
    // which is most of a real feed.
    expect(inferGarmentType("Erkek Ceketi", "")).toBe("outerwear");
    expect(inferGarmentType("Ceketler", "")).toBe("outerwear");
    expect(inferGarmentType("Pantolonu", "")).toBe("bottom");
    expect(inferGarmentType("Ayakkabıları", "")).toBe("shoes");
    expect(inferGarmentType("Gömlekler", "")).toBe("top");
  });

  it("prefers the category over the name when they disagree", () => {
    expect(inferGarmentType("Elbise", "Ceket Yaka Elbise")).toBe("dress");
  });

  it("admits when it cannot tell", () => {
    expect(inferGarmentType("Hediye Kartı", "Hediye Kartı")).toBe("unknown");
    expect(inferGarmentType(undefined, undefined)).toBe("unknown");
  });
});

describe("parsePriceMinor", () => {
  it("reads Turkish thousands separators without dividing by 1000", () => {
    expect(parsePriceMinor("12.900,00")).toBe(1290000);
    expect(parsePriceMinor("12.900")).toBe(1290000);
    expect(parsePriceMinor("₺ 41.500,50")).toBe(4150050);
  });

  it("reads international formatting too", () => {
    expect(parsePriceMinor("12,900.00")).toBe(1290000);
    expect(parsePriceMinor("850.00")).toBe(85000);
    expect(parsePriceMinor("850")).toBe(85000);
  });

  it("never produces a float artefact", () => {
    expect(Number.isInteger(parsePriceMinor("12.900,99"))).toBe(true);
    expect(parsePriceMinor("12.900,99")).toBe(1290099);
  });

  it("rejects unusable input", () => {
    expect(parsePriceMinor(undefined)).toBeNull();
    expect(parsePriceMinor("")).toBeNull();
    expect(parsePriceMinor("fiyat sorunuz")).toBeNull();
  });
});

describe("formatPrice", () => {
  it("renders grouped Turkish output", () => {
    expect(formatPrice(1290000, "TRY")).toBe("12.900 ₺");
    expect(formatPrice(85050, "EUR")).toBe("850,50 €");
  });
});

describe("parseFabrics", () => {
  it("reads percent-first (Turkish) composition", () => {
    expect(parseFabrics("%70 Pamuk %30 Keten")).toEqual([
      { name: "pamuk", percentage: 70 },
      { name: "keten", percentage: 30 },
    ]);
  });

  it("reads percent-last (English) composition", () => {
    expect(parseFabrics("Cotton 70%, Linen 30%")).toEqual([
      { name: "cotton", percentage: 70 },
      { name: "linen", percentage: 30 },
    ]);
  });

  it("returns empty for prose rather than inventing a fibre", () => {
    expect(parseFabrics("Yumuşak dokulu kumaş")).toEqual([]);
    expect(parseFabrics(undefined)).toEqual([]);
  });
});

describe("colorFamilyOf", () => {
  it("separates navy from blue — they do not pair the same way", () => {
    expect(colorFamilyOf("Lacivert")).toBe("navy");
    expect(colorFamilyOf("Mavi")).toBe("blue");
  });

  it("survives Turkish suffixes and diacritics", () => {
    expect(colorFamilyOf("Şeker Pembesi Ombre")).toBe("pink");
    expect(colorFamilyOf("Koyu Yeşil")).toBe("green");
    expect(colorFamilyOf("Füme")).toBe("grey");
    expect(colorFamilyOf("Kırmızısı")).toBe("red");
  });

  it("gives up on colours it does not know", () => {
    expect(colorFamilyOf("Multicolor")).toBeUndefined();
    expect(colorFamilyOf("Desenli")).toBeUndefined();
  });
});

describe("parseSeasons / parseSizes", () => {
  it("expands season shorthand", () => {
    expect(parseSeasons("Sonbahar")).toEqual(["autumn"]);
    expect(parseSeasons("AW")).toEqual(["autumn", "winter"]);
    expect(parseSeasons("4 Mevsim")).toHaveLength(4);
  });

  it("splits sizes on every separator brands use, de-duplicated", () => {
    expect(parseSizes("48,50,52")).toEqual(["48", "50", "52"]);
    expect(parseSizes("S | M | L")).toEqual(["S", "M", "L"]);
    expect(parseSizes(["48", "48", "50"])).toEqual(["48", "50"]);
    expect(parseSizes(undefined)).toEqual([]);
  });
});

describe("selectItems", () => {
  it("wraps a single-product feed instead of importing zero", () => {
    expect(selectItems({ Products: { Product: { a: 1 } } }, "Products.Product")).toHaveLength(1);
    expect(selectItems({ Products: { Product: [{ a: 1 }, { a: 2 }] } }, "Products.Product")).toHaveLength(2);
    expect(selectItems({}, "Products.Product")).toEqual([]);
  });
});

describe("normalizeProduct", () => {
  it("normalises a realistic Turkish menswear row end to end", () => {
    const { product, rejected, issues } = normalizeProduct(row, feed);
    expect(rejected).toBe(false);
    expect(issues).toEqual([]);
    expect(product).toMatchObject({
      sku: "GG-CT-0412",
      department: "men",
      garmentType: "outerwear",
      colorFamily: "navy",
      priceMinor: 1290000,
      priceDisplay: "12.900 ₺",
      seasons: ["autumn"],
      relatedSkus: ["GG-PT-0311", "GG-SH-0102"],
    });
    expect(product!.fabrics).toEqual([
      { name: "yün", percentage: 70 },
      { name: "polyester", percentage: 30 },
    ]);
    expect(product!.variants).toEqual([
      { size: "48", stock: 7 },
      { size: "50", stock: 7 },
      { size: "52", stock: 7 },
      { size: "54", stock: 7 },
    ]);
  });

  it("rejects a row with no department instead of defaulting it", () => {
    const { product, rejected, issues } = normalizeProduct(
      { ...row, Cinsiyet: "" },
      feed,
    );
    expect(rejected).toBe(true);
    expect(product).toBeNull();
    expect(issues[0]).toContain("department");
  });

  it("names every missing required field in one issue, not one at a time", () => {
    const { issues } = normalizeProduct({ StokKodu: "X" }, feed);
    expect(issues[0]).toContain("name");
    expect(issues[0]).toContain("price");
    expect(issues[0]).toContain("imageMain");
  });

  it("applies tenant defaults for a single-department brand", () => {
    const menswearOnly: TenantFeed = {
      ...feed,
      map: { ...feed.map, department: "" },
      defaults: { department: "men" },
    };
    const { product, rejected } = normalizeProduct(
      { ...row, Cinsiyet: undefined },
      menswearOnly,
    );
    expect(rejected).toBe(false);
    expect(product!.department).toBe("men");
  });

  it("applies a tenant value map for coded feeds", () => {
    const coded: TenantFeed = { ...feed, valueMap: { department: { "1": "men" } } };
    const { product } = normalizeProduct({ ...row, Cinsiyet: "1" }, coded);
    expect(product!.department).toBe("men");
  });

  it("keeps a product with no stock column distinguishable from zero stock", () => {
    const noStock: TenantFeed = { ...feed, map: { ...feed.map, stock: "" } };
    const { product } = normalizeProduct(row, noStock);
    expect(product!.variants.every((v) => v.stock === null)).toBe(true);
  });

  it("imports an unclassifiable piece but flags it out of outfits", () => {
    const { product, rejected, issues } = normalizeProduct(
      { ...row, Kategori: "Hediye Kartı", UrunAdi: "Hediye Kartı" },
      feed,
    );
    expect(rejected).toBe(false);
    expect(product!.garmentType).toBe("unknown");
    expect(issues.join(" ")).toContain("Parça tipi");
  });
});
