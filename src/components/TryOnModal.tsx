"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductCard } from "./ProductCards";

/* The mannequin view. Renders the outfit currently on screen on the brand's
   reference model.

   Two rules carried over from the rest of the widget rather than re-decided
   here: a size is never guessed (the add-to-cart button opens the product
   instead when we don't know one — a wrong size is the most expensive kind of
   return for a clothing brand), and a failure says what actually went wrong
   instead of a generic retry prompt, because the usual cause is a garment
   image the brand's feed serves in a format the renderer cannot read. */

interface TryOnResult {
  imageUrl: string;
  worn: { sku: string; name: string; priceDisplay: string; slot: string }[];
  dropped: string[];
  issues?: string[];
}

const ERROR_TEXT: Record<string, string> = {
  tryon_not_enabled: "Bu marka için mankende görme özelliği açık değil.",
  no_garment_images:
    "Bu parçaların görselleri giydirme için okunamadı, o yüzden manken görseli üretilmedi.",
  no_skus: "Giydirilecek parça seçilmemiş.",
  skus_not_in_catalog: "Seçilen parçalar katalogda bulunamadı.",
  outfit_not_plannable: "Bu parçalar bir kombin olarak giydirilemedi.",
  rate_limited: "Çok sık denendi. Birkaç saniye sonra tekrar deneyin.",
  render_failed: "Görsel üretilirken bir sorun oldu.",
  no_image_returned: "Görsel modeli bu kombin için çıktı üretemedi.",
  origin_not_allowed: "Bu site için mankende görme etkin değil.",
  tryon_unconfigured: "Görsel üretimi yapılandırılmamış.",
};

export function TryOnModal({
  tenantSlug,
  sessionId,
  products,
  onClose,
  onSelect,
  onAddToCart,
}: {
  tenantSlug: string;
  sessionId: string;
  products: ProductCard[];
  onClose: () => void;
  onSelect: (p: ProductCard) => void;
  onAddToCart: (p: ProductCard, size: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [result, setResult] = useState<TryOnResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* Runs the render. Deliberately performs NO synchronous state update before
     its first await: the component already mounts in the loading state, so the
     mount effect can call this without triggering a cascading render (which is
     both a lint error and a wasted pass). The retry button sets the loading
     state itself — an event handler is the right place for that. */
  const generate = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ tenant: tenantSlug, sessionId, skus: products.map((p) => p.sku) }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(ERROR_TEXT[data.error] ?? data.message ?? "Görsel oluşturulamadı.");
        setIssues(Array.isArray(data.issues) ? data.issues : []);
        return;
      }
      setResult({
        imageUrl: data.imageUrl,
        worn: data.worn ?? [],
        dropped: data.dropped ?? [],
        issues: data.issues ?? [],
      });
      setIssues(Array.isArray(data.issues) ? data.issues : []);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Bağlantı sorunu oldu.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [tenantSlug, sessionId, products]);

  useEffect(() => {
    // Microtask hop so the first state update lands after this render commits
    // rather than inside the effect body.
    void Promise.resolve().then(generate);
    return () => abortRef.current?.abort();
  }, [generate]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setIssues([]);
    void generate();
  }, [generate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Which pieces actually made it into the render — a conflicting piece is
  // dropped by the layering planner, and showing it as "worn" would be a
  // small lie the customer can see.
  const wornSkus = new Set(result?.worn.map((w) => w.sku) ?? []);
  const shown = result ? products.filter((p) => wornSkus.has(p.sku)) : products;

  return (
    <div className="rv-vton-overlay" role="dialog" aria-modal="true" aria-label="Mankende gör">
      <div className="rv-vton-dialog">
        <header className="rv-vton-header">
          <span className="rv-vton-title">Mankende Gör</span>
          <button type="button" className="rv-vton-close" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>

        <div className="rv-vton-content">
          {loading && (
            <div className="rv-vton-loading" aria-live="polite">
              <div className="rv-vton-spinner" />
              <p>Kombin manken üzerine giydiriliyor…</p>
              <span className="rv-vton-sub">Bu yaklaşık 20 saniye sürebilir.</span>
            </div>
          )}

          {error && !loading && (
            <div className="rv-vton-error" role="alert">
              <p>{error}</p>
              {issues.length > 0 && (
                <ul className="rv-vton-issues">
                  {issues.slice(0, 4).map((iss) => (
                    <li key={iss}>{iss}</li>
                  ))}
                </ul>
              )}
              <button type="button" className="rv-vton-retry" onClick={retry}>
                Tekrar dene
              </button>
            </div>
          )}

          {result && !loading && (
            <>
              <div className="rv-vton-image-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.imageUrl} alt="Kombinin manken üzerindeki görünümü" />
              </div>

              {result.dropped.length > 0 && (
                <p className="rv-vton-note">
                  Aynı katmana denk geldiği için {result.dropped.length} parça bu görsele
                  girmedi.
                </p>
              )}

              <div className="rv-vton-pieces">
                {shown.map((p) => (
                  <div key={p.sku} className="rv-vton-piece">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="rv-vton-thumb" />
                    ) : (
                      <span className="rv-vton-thumb" />
                    )}
                    <span className="rv-vton-piece-name">{p.name}</span>
                    <span className="rv-vton-piece-price">{p.price}</span>
                    {p.sizes.length === 1 ? (
                      <button
                        type="button"
                        className="rv-vton-add"
                        onClick={() => onAddToCart(p, p.sizes[0])}
                      >
                        Sepete ekle
                      </button>
                    ) : (
                      // More than one size (or none known): never pick one on
                      // the customer's behalf — send them to the product.
                      <button type="button" className="rv-vton-add" onClick={() => onSelect(p)}>
                        Beden seç
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
