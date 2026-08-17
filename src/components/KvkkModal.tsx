"use client";

import React from "react";
import { getKvkkTexts } from "@/lib/kvkk/legal-texts";

interface KvkkModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantName?: string;
}

export function KvkkModal({ isOpen, onClose, tenantName = "Giovane Gentile" }: KvkkModalProps) {
  if (!isOpen) return null;

  const texts = getKvkkTexts(tenantName);

  return (
    <div className="rv-modal-backdrop" onClick={onClose}>
      <div className="rv-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="rv-modal-header">
          <h3>{texts.clarificationTitle}</h3>
          <button type="button" className="rv-modal-close" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>

        <div className="rv-modal-body">
          <p className="rv-modal-meta"><strong>{texts.dataController}</strong></p>
          <p className="rv-modal-intro">{texts.purposeText}</p>
          <div className="rv-modal-text">
            {texts.clarificationBody.split("\n\n").map((paragraph, index) => (
              <p key={index}>{paragraph.trim()}</p>
            ))}
          </div>
        </div>

        <footer className="rv-modal-footer">
          <button type="button" className="rv-btn-primary" onClick={onClose}>
            Anladım
          </button>
        </footer>
      </div>
    </div>
  );
}
