"use client";

import React, { useState } from "react";
import type { UserStyleDna } from "@/lib/memory/types";
import { getKvkkTexts } from "@/lib/kvkk/legal-texts";

interface StyleMemoryBarProps {
  tenantSlug: string;
  tenantName: string;
  styleDna: UserStyleDna | null;
  userEmail: string;
  consentGiven: boolean;
  onConsentChange: (email: string, consent: boolean, styleDna?: UserStyleDna | null) => void;
  onClearMemory: () => void;
  onOpenKvkkModal: () => void;
}

export function StyleMemoryBar({
  tenantSlug,
  tenantName,
  styleDna,
  userEmail,
  consentGiven,
  onConsentChange,
  onClearMemory,
  onOpenKvkkModal,
}: StyleMemoryBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputEmail, setInputEmail] = useState(userEmail);
  const [checkedConsent, setCheckedConsent] = useState(consentGiven);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const texts = getKvkkTexts(tenantName);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputEmail.trim() || !inputEmail.includes("@")) {
      setStatusMsg("Lütfen geçerli bir e-posta adresi girin.");
      return;
    }

    setLoading(true);
    setStatusMsg(null);

    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant: tenantSlug,
          email: inputEmail.trim(),
          consentGiven: checkedConsent,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        onConsentChange(inputEmail.trim(), checkedConsent, data.styleDna);
        setStatusMsg(
          checkedConsent
            ? "Stil hafızanız aktifleştirildi."
            : "Misafir modu devrede. Hafıza kaydedilmiyor."
        );
        setTimeout(() => setIsOpen(false), 1200);
      } else {
        setStatusMsg(data.error || "Bir hata oluştu.");
      }
    } catch {
      setStatusMsg("Bağlantı hatası oluştu.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("Tüm stil hafızanız ve geçmiş tercihleriniz kalıcı olarak silinecek. Emin misiniz?")) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/memory", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant: tenantSlug,
          email: userEmail || inputEmail,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        onClearMemory();
        setInputEmail("");
        setCheckedConsent(false);
        setStatusMsg("Stil hafızanız silindi. Misafir modundasınız.");
        setTimeout(() => setIsOpen(false), 1500);
      }
    } catch {
      setStatusMsg("Silme işlemi başarısız oldu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rv-memory-container">
      {/* Mini status bar on top of chat */}
      <div className="rv-memory-pill-bar">
        {consentGiven && styleDna ? (
          <div className="rv-memory-status-active">
            <span className="rv-status-dot green" />
            <span className="rv-status-label">
              Stil Hafızası Aktif ({styleDna.displayEmail || "Üye"})
            </span>
            <button
              type="button"
              className="rv-link-btn"
              onClick={() => setIsOpen(!isOpen)}
            >
              {isOpen ? "Gizle" : "Yönet / Sil"}
            </button>
          </div>
        ) : (
          <div className="rv-memory-status-guest">
            <span className="rv-status-dot gray" />
            <span className="rv-status-label">Misafir Modu (Hafıza Kapalı)</span>
            <button
              type="button"
              className="rv-link-btn highlight"
              onClick={() => setIsOpen(!isOpen)}
            >
              {isOpen ? "Kapat" : "Kişiselleştir ✦"}
            </button>
          </div>
        )}
      </div>

      {/* Expandable Memory & Consent Drawer */}
      {isOpen && (
        <div className="rv-memory-drawer">
          <h4>Kişisel Stil Hafızası & KVKK Tercihleri</h4>
          <p className="rv-drawer-desc">
            Geçmiş alışverişlerinize ve beden ölçülerinize uygun özel kombinler
            sunabilmemiz için e-posta adresinizi bağlayabilirsiniz.
          </p>

          <form onSubmit={handleSave} className="rv-memory-form">
            <div className="rv-input-group">
              <label htmlFor="rv-email-input">E-posta Adresiniz</label>
              <input
                id="rv-email-input"
                type="email"
                placeholder="ornek@giovanegentile.com"
                value={inputEmail}
                onChange={(e) => setInputEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            {/* KVKK Checkbox */}
            <div className="rv-consent-box">
              <label className="rv-checkbox-label">
                <input
                  type="checkbox"
                  checked={checkedConsent}
                  onChange={(e) => setCheckedConsent(e.target.checked)}
                  disabled={loading}
                />
                <span className="rv-consent-text">
                  {texts.consentCheckboxText}{" "}
                  <button
                    type="button"
                    className="rv-kvkk-link"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenKvkkModal();
                    }}
                  >
                    [Stil Danışmanı Aydınlatma Metni]
                  </button>
                </span>
              </label>
            </div>

            {statusMsg && <div className="rv-form-status">{statusMsg}</div>}

            <div className="rv-drawer-actions">
              <button
                type="submit"
                className="rv-btn-save"
                disabled={loading}
              >
                {loading
                  ? "İşleniyor..."
                  : checkedConsent
                  ? "Hafızayı Başlat"
                  : "Misafir Olarak Devam Et"}
              </button>

              {consentGiven && (
                <button
                  type="button"
                  className="rv-btn-danger"
                  onClick={handleClear}
                  disabled={loading}
                  title="KVKK m.11 Unutulma Hakkı: Tüm tercihlerinizi kalıcı olarak siler"
                >
                  🗑️ Stil Hafızamı Temizle
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
