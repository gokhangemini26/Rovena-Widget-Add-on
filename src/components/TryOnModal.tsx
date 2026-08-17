"use client";

import { useState } from "react";
import type { ProductCard } from "./ProductCards";

interface TryOnModalProps {
  tenantSlug: string;
  products: ProductCard[];
  onClose: () => void;
  onAddToCart: (p: ProductCard, size: string) => void;
}

export function TryOnModal({
  tenantSlug,
  products,
  onClose,
  onAddToCart,
}: TryOnModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [wornItems, setWornItems] = useState<Array<{ name: string; priceDisplay: string; slot: string }>>([]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: tenantSlug,
          skus: products.map((p) => p.sku),
          products,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Görsel oluşturulamadı.");
      } else {
        setResultImage(data.imageUrl);
        setWornItems(data.worn || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bağlantı hatası");
    } finally {
      setLoading(false);
    }
  };

  // Auto trigger generation on mount if not loaded
  useState(() => {
    handleGenerate();
  });

  return (
    <div className="rv-vton-overlay">
      <div className="rv-vton-dialog">
        <div className="rv-vton-header">
          <div className="rv-vton-title">
            <span>✨ Mankende Gör</span>
            <span className="rv-vton-badge">AI Try-On</span>
          </div>
          <button type="button" className="rv-vton-close" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className="rv-vton-content">
          {loading && (
            <div className="rv-vton-loading">
              <div className="rv-vton-spinner" />
              <p className="rv-vton-loading-text">
                Kombin parçaları analiz ediliyor ve manken üzerine giydiriliyor...
              </p>
              <span className="rv-vton-loading-sub">Gemini 3.1 Flash Image Rendering</span>
            </div>
          )}

          {error && !loading && (
            <div className="rv-vton-error">
              <p>⚠️ {error}</p>
              <button type="button" className="rv-vton-retry-btn" onClick={handleGenerate}>
                Tekrar Dene 🔄
              </button>
            </div>
          )}

          {resultImage && !loading && (
            <div className="rv-vton-result">
              <div className="rv-vton-image-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resultImage} alt="Kombin Manken Görünümü" className="rv-vton-img" />
              </div>

              <div className="rv-vton-pieces">
                <h4>Kombindeki Parçalar:</h4>
                <div className="rv-vton-piece-list">
                  {products.map((p) => (
                    <div key={p.sku} className="rv-vton-piece-item">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.image} alt={p.name} className="rv-vton-piece-thumb" />
                      <div className="rv-vton-piece-meta">
                        <span className="rv-vton-piece-name">{p.name}</span>
                        <span className="rv-vton-piece-price">{p.price}</span>
                      </div>
                      <button
                        type="button"
                        className="rv-vton-add-single"
                        onClick={() => onAddToCart(p, p.sizes[0] || "M")}
                        title="Bu parçayı sepete ekle"
                      >
                        + Sepet
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
