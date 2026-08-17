import { describe, it, expect } from "vitest";
import { stripVoiceLeak } from "./transcriptFilter";

describe("stripVoiceLeak", () => {
  it("removes a real leak observed live: 'Context: showProducts called successfully.'", () => {
    const raw =
      "Resmi bir davet için slim fit lacivert takım elbisemiz gayet uygun olacaktır. " +
      "Nasıl, beğendiniz mi? Context: showProducts called successfully.";
    const out = stripVoiceLeak(raw);
    expect(out).not.toContain("Context");
    expect(out).not.toContain("showProducts");
    expect(out).toContain("takım elbisemiz");
  });

  it("removes a second, differently-phrased leak of the same failure", () => {
    const raw =
      "Klasik bir görünüm yakalayabilirsiniz. Bu kombini düşünür müsünüz? " +
      "showProducts function ile ürünleri gösteriyorum.";
    const out = stripVoiceLeak(raw);
    expect(out).not.toContain("showProducts");
    expect(out).toContain("Klasik bir görünüm");
  });

  it("leaves ordinary customer-facing sentences untouched", () => {
    const raw = "52 bedeni koleksiyonda listeli; stok teyidini mağazadan almak gerekiyor.";
    expect(stripVoiceLeak(raw)).toBe(raw);
  });

  it("drops every tool name, not just the ones seen live", () => {
    for (const tool of ["searchProducts", "getProducts", "checkStock", "addToCart"]) {
      const raw = `Bir cümle. ${tool} çağrısı yapıldı. Başka bir cümle.`;
      const out = stripVoiceLeak(raw);
      expect(out).not.toContain(tool);
      expect(out).toContain("Bir cümle");
      expect(out).toContain("Başka bir cümle");
    }
  });

  it("returns empty string for input that was entirely machinery", () => {
    expect(stripVoiceLeak("Context: showProducts called successfully.")).toBe("");
  });
});
