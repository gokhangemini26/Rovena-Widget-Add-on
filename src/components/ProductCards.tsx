"use client";

import { useState } from "react";

export interface ProductCard {
  sku: string;
  name: string;
  price: string;
  image: string;
  url: string;
  sizes: string[];
  category?: string;
}

/* An outfit, shown as a row. Horizontal rather than stacked because the pieces
   of one look are read together — stacking them turns a styled outfit back into
   a list of products, which is the thing the widget exists to stop being. */

export function ProductCards({
  title,
  products,
  onSelect,
  onAddToCart,
  onTryOn,
}: {
  title?: string;
  products: ProductCard[];
  onSelect: (p: ProductCard) => void;
  onAddToCart: (p: ProductCard, size: string) => void;
  onTryOn?: (products: ProductCard[]) => void;
}) {
  return (
    <div className="rv-products">
      <div className="rv-products-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        {title && <div className="rv-products-title">{title}</div>}
        {onTryOn && products.length > 0 && (
          <button
            type="button"
            className="rv-tryon-trigger"
            onClick={() => onTryOn(products)}
            style={{
              background: "var(--rv-accent)",
              color: "var(--rv-accent-ink)",
              border: 0,
              borderRadius: 99,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>✨</span>
            <span>Mankende Gör</span>
          </button>
        )}
      </div>
      <div className="rv-products-row">
        {products.map((p, i) => (
          <Card
            key={p.sku}
            product={p}
            onSelect={onSelect}
            onAddToCart={onAddToCart}
            // The first two are the payoff of the whole conversation and are on
            // screen the instant they mount; lazy-loading them costs a visible
            // beat for nothing. The rest are off to the right behind a scroll.
            eager={i < 2}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  product,
  onSelect,
  onAddToCart,
  eager,
}: {
  product: ProductCard;
  onSelect: (p: ProductCard) => void;
  onAddToCart: (p: ProductCard, size: string) => void;
  eager: boolean;
}) {
  const [size, setSize] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    // A size is mandatory before anything reaches a cart. Guessing one produces
    // the single most expensive kind of return for a clothing brand.
    if (!size) return;
    onAddToCart(product, size);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2200);
  };

  return (
    <article className="rv-card">
      <button
        type="button"
        className="rv-card-image"
        onClick={() => onSelect(product)}
        aria-label={`${product.name} ürününü aç`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.image} alt={product.name} loading={eager ? "eager" : "lazy"} />
      </button>

      <div className="rv-card-body">
        <div className="rv-card-name" title={product.name}>{product.name}</div>
        <div className="rv-card-price">{product.price}</div>

        {product.sizes.length > 0 && (
          <div className="rv-sizes" role="group" aria-label="Beden seçin">
            {product.sizes.slice(0, 8).map((s) => (
              <button
                key={s}
                type="button"
                className={`rv-size ${size === s ? "rv-size-on" : ""}`}
                aria-pressed={size === s}
                onClick={() => setSize(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="rv-add"
          disabled={!size || added}
          onClick={handleAdd}
        >
          {added ? "Eklendi ✓" : size ? "Sepete ekle" : "Beden seçin"}
        </button>
      </div>
    </article>
  );
}
