"use client";

import { useState } from "react";
import type { TenantTheme, TenantPersona } from "@/lib/tenant/types";

interface LivePreviewProps {
  tenantSlug: string;
  theme?: TenantTheme;
  persona?: TenantPersona;
  refreshKey?: number;
}

export function LivePreview({ tenantSlug, theme, persona, refreshKey = 0 }: LivePreviewProps) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [key, setKey] = useState(0);

  const previewUrl = `/embed/${tenantSlug}?preview=1&v=${refreshKey}-${key}`;

  return (
    <div className="live-preview-panel">
      <div className="preview-header">
        <div className="preview-title">
          <span className="live-dot" /> Canlı Widget Önizlemesi
        </div>
        <div className="device-toggles">
          <button
            type="button"
            className={`btn-device ${device === "mobile" ? "active" : ""}`}
            onClick={() => setDevice("mobile")}
          >
            📱 Mobil
          </button>
          <button
            type="button"
            className={`btn-device ${device === "desktop" ? "active" : ""}`}
            onClick={() => setDevice("desktop")}
          >
            💻 Masaüstü
          </button>
          <button
            type="button"
            className="btn-refresh"
            onClick={() => setKey((k) => k + 1)}
            title="Yenile"
          >
            🔄
          </button>
        </div>
      </div>

      <div className={`preview-viewport viewport-${device}`}>
        <div className="simulated-browser">
          <div className="browser-bar">
            <div className="browser-dots">
              <span className="dot dot-red" />
              <span className="dot dot-yellow" />
              <span className="dot dot-green" />
            </div>
            <div className="browser-url">
              https://{tenantSlug}.com/store
            </div>
          </div>

          <div className="browser-content">
            <div className="mock-storefront-bg">
              <div className="mock-banner">
                <span className="mock-brand">{persona?.displayName || "Marka Vitrini"}</span>
                <span className="mock-season">Yeni Sezon Koleksiyonu</span>
              </div>
              <div className="mock-grid">
                <div className="mock-card" />
                <div className="mock-card" />
                <div className="mock-card" />
                <div className="mock-card" />
              </div>
            </div>

            {/* The Actual Live Widget Frame */}
            <div
              className={`widget-frame-container ${
                theme?.position === "bottom-left" ? "pos-left" : "pos-right"
              }`}
            >
              <iframe
                key={`${tenantSlug}-${refreshKey}-${key}`}
                src={previewUrl}
                title="Rovena Widget Live Preview"
                className="widget-iframe"
                style={{
                  borderRadius: theme?.radius ? `${theme.radius}px` : "12px",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
