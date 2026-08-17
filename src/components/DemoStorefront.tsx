"use client";

import { useEffect, useState } from "react";
import type { Tenant } from "@/lib/tenant/types";
import type { Product } from "@/lib/catalog/types";

interface CartItem {
  sku: string;
  name: string;
  price: string;
  size?: string;
  image?: string;
  quantity: number;
}

declare global {
  interface Window {
    rovenaAddToCart?: (item: { sku: string; size?: string; quantity?: number; url?: string }) => boolean;
  }
}

export function DemoStorefront({
  tenant,
  products,
}: {
  tenant: Tenant;
  products: Product[];
}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeToast, setActiveToast] = useState<string | null>(null);
  const [highlightedSku, setHighlightedSku] = useState<string | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Register host cart bridge handler
  useEffect(() => {
    window.rovenaAddToCart = (item) => {
      const found = products.find((p) => p.sku === item.sku);
      const name = found ? found.name : item.sku;
      const price = found ? found.priceDisplay : "—";
      const image = found?.imageMain;

      setCart((prev) => {
        const existing = prev.find((i) => i.sku === item.sku && i.size === (item.size || "Standart"));
        if (existing) {
          return prev.map((i) =>
            i === existing ? { ...i, quantity: i.quantity + (item.quantity || 1) } : i
          );
        }
        return [
          ...prev,
          {
            sku: item.sku,
            name,
            price,
            size: item.size || "M",
            image,
            quantity: item.quantity || 1,
          },
        ];
      });

      // Show toast
      setActiveToast(`✨ ${name} (${item.size || "Standart"}) sepetinize eklendi!`);
      setTimeout(() => setActiveToast(null), 4000);

      // Highlight on page
      setHighlightedSku(item.sku);
      setTimeout(() => setHighlightedSku(null), 3000);

      return true;
    };

    // Listen to messages from Rovena iframe
    const onMessage = (ev: MessageEvent) => {
      if (!ev.data || ev.data.source !== "rovena") return;
      if (ev.data.type === "add-to-cart" && ev.data.payload) {
        window.rovenaAddToCart?.(ev.data.payload);
      }
      if (ev.data.type === "navigate" && ev.data.payload?.sku) {
        const sku = ev.data.payload.sku;
        setHighlightedSku(sku);
        const el = document.getElementById(`product-${sku}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => setHighlightedSku(null), 4000);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [products]);

  // Sync cart state back to Rovena widget
  useEffect(() => {
    if (window.Rovena && window.Rovena.setCart) {
      window.Rovena.setCart(cart.map((c) => c.sku));
    }
  }, [cart]);

  const totalCount = cart.reduce((acc, i) => acc + i.quantity, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#fbfaf8", color: "#16130f", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Toast Notification */}
      {activeToast && (
        <div
          style={{
            position: "fixed",
            top: 24,
            right: 24,
            zIndex: 99999,
            background: "#16130f",
            color: "#fff",
            padding: "14px 20px",
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            fontSize: 14,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 10,
            animation: "fadeIn 0.3s ease",
          }}
        >
          <span>🛍️</span>
          <span>{activeToast}</span>
        </div>
      )}

      {/* Header */}
      <header
        style={{
          borderBottom: "1px solid #ede8e1",
          background: "#ffffff",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#16130f" }}>
              {tenant.name.toUpperCase()}
            </span>
            <span
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                background: "#f3efe8",
                color: "#786d5e",
                padding: "3px 8px",
                borderRadius: 4,
                fontWeight: 600,
              }}
            >
              Canlı Mağaza Vitrini
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              type="button"
              onClick={() => window.Rovena?.open()}
              style={{
                background: "none",
                border: "1px solid #ded6c9",
                borderRadius: 20,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>✨</span>
              <span>{tenant.persona.displayName} ile Konuş</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCartOpen(!isCartOpen)}
              style={{
                background: totalCount > 0 ? "#16130f" : "#f3efe8",
                color: totalCount > 0 ? "#ffffff" : "#16130f",
                border: 0,
                borderRadius: 20,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "all 0.2s ease",
              }}
            >
              <span>🛒</span>
              <span>Sepet ({totalCount})</span>
            </button>
          </div>
        </div>
      </header>

      {/* Cart Drawer Modal */}
      {isCartOpen && (
        <div
          style={{
            position: "fixed",
            top: 70,
            right: 24,
            width: 340,
            background: "#ffffff",
            borderRadius: 16,
            boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
            border: "1px solid #ede8e1",
            padding: 20,
            zIndex: 999,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Alışveriş Sepeti ({totalCount})</h3>
            <button
              type="button"
              onClick={() => setIsCartOpen(false)}
              style={{ background: "none", border: 0, cursor: "pointer", fontSize: 16 }}
            >
              ✕
            </button>
          </div>

          {cart.length === 0 ? (
            <p style={{ fontSize: 13, color: "#8a7f72", textAlign: "center", padding: "24px 0" }}>
              Sepetiniz henüz boş. AI Stiliste &ldquo;bunu sepete ekle&rdquo; diyebilirsiniz!
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 320, overflowY: "auto" }}>
              {cart.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 8,
                    background: "#faf8f5",
                    borderRadius: 8,
                  }}
                >
                  {item.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image}
                      alt={item.name}
                      style={{ width: 44, height: 56, objectFit: "cover", borderRadius: 4 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#786d5e" }}>
                      Beden: {item.size} · Adet: {item.quantity}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{item.price}</div>
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #ede8e1", paddingTop: 12, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => alert("Sipariş tamamlama aşamasına yönlendiriliyorsunuz.")}
                  style={{
                    width: "100%",
                    background: "#16130f",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "10px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Ödemeye Geç →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hero Banner */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px 24px" }}>
        <div
          style={{
            background: "linear-gradient(135deg, #1f1b16 0%, #342c23 100%)",
            color: "#ffffff",
            borderRadius: 20,
            padding: "48px 40px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            boxShadow: "0 12px 36px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ maxWidth: 580 }}>
            <span style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#d5b480" }}>
              Yeni Sezon Koleksiyonu
            </span>
            <h1 style={{ fontSize: 36, fontWeight: 700, margin: "12px 0 16px", lineHeight: 1.2 }}>
              {tenant.name} &times; AI Stilist Deneyimi
            </h1>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#d8d1c7", margin: 0 }}>
              AI Stilist ile doğrudan konuşarak kombin önerisi alabilir, kıyafetleri manken üzerinde görebilir ve beğendiğiniz parçaları anında sepetinize ekleyebilirsiniz.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.Rovena?.open()}
            style={{
              background: "#d5b480",
              color: "#16130f",
              border: 0,
              borderRadius: 30,
              padding: "16px 28px",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(213,180,128,0.35)",
            }}
          >
            ✨ Stilisti Başlat
          </button>
        </div>
      </section>

      {/* Product Catalog Grid */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Koleksiyondaki Parçalar</h2>
          <span style={{ fontSize: 13, color: "#786d5e" }}>{products.length} ürün listeleniyor</span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 24,
          }}
        >
          {products.map((p) => {
            const isHighlighted = highlightedSku === p.sku;
            return (
              <div
                key={p.sku}
                id={`product-${p.sku}`}
                style={{
                  background: "#ffffff",
                  borderRadius: 16,
                  overflow: "hidden",
                  border: isHighlighted ? "2px solid #d5b480" : "1px solid #ede8e1",
                  boxShadow: isHighlighted ? "0 0 24px rgba(213,180,128,0.5)" : "0 4px 12px rgba(0,0,0,0.03)",
                  transition: "all 0.3s ease",
                  transform: isHighlighted ? "scale(1.02)" : "scale(1)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ position: "relative", height: 320, background: "#f2ece4", overflow: "hidden" }}>
                  {p.imageMain ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageMain}
                      alt={p.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#a59c90" }}>
                      Görsel Yok
                    </div>
                  )}
                  <span
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 12,
                      background: "rgba(255,255,255,0.9)",
                      backdropFilter: "blur(4px)",
                      padding: "4px 8px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      color: "#16130f",
                    }}
                  >
                    {p.category}
                  </span>
                </div>

                <div style={{ padding: 16, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 4px", lineHeight: 1.3 }}>{p.name}</h3>
                    <p style={{ fontSize: 12, color: "#786d5e", margin: "0 0 12px" }}>SKU: {p.sku}</p>
                  </div>

                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                      {p.priceDisplay}
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => window.Rovena?.openWithProduct(p.sku)}
                        style={{
                          flex: 1,
                          background: "#f5f0e8",
                          color: "#5b4a34",
                          border: "1px solid #ded3c1",
                          borderRadius: 8,
                          padding: "8px 10px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        ✨ Kombinle
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const size = p.variants[0]?.size || "M";
                          window.rovenaAddToCart?.({ sku: p.sku, size, quantity: 1 });
                        }}
                        style={{
                          flex: 1,
                          background: "#16130f",
                          color: "#ffffff",
                          border: 0,
                          borderRadius: 8,
                          padding: "8px 10px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Sepete Ekle
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
