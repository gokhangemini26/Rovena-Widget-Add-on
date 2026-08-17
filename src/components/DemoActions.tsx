"use client";

/* The two calls a brand's product page makes into the widget. Kept as a real,
   working component rather than a code sample so the demo proves the public API
   actually exists. */

declare global {
  interface Window {
    Rovena?: {
      open: () => void;
      close: () => void;
      toggle: () => void;
      setProduct: (sku: string) => void;
      setCart: (skus: string[]) => void;
      ask: (text: string) => void;
      isReady: () => boolean;
    };
  }
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid #d8d0c4",
  background: "#fff",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 14,
  cursor: "pointer",
};

export function DemoActions({ sku }: { sku?: string }) {
  const guard = (fn: () => void) => () => {
    if (!window.Rovena) {
      console.warn("[Rovena] Loader henüz yüklenmedi.");
      return;
    }
    fn();
  };

  return (
    <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
      <button
        type="button"
        style={buttonStyle}
        onClick={guard(() => {
          if (sku) window.Rovena!.setProduct(sku);
          window.Rovena!.ask("Bu parçayı neyle kombinlerim?");
        })}
      >
        Bu parçayı kombinle
      </button>
      <button type="button" style={buttonStyle} onClick={guard(() => window.Rovena!.open())}>
        Danışmanı aç
      </button>
    </div>
  );
}
