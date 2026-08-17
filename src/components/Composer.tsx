"use client";

import { useRef, useState } from "react";
import type { Locale } from "@/lib/tenant/types";

const PLACEHOLDER: Record<Locale, string> = {
  tr: "Ne giymek istediğinizi yazın veya konuşun…",
  en: "Tell me what you're dressing for…",
  de: "Wofür möchten Sie sich anziehen?",
  it: "Per quale occasione ti vesti?",
};

export function Composer({
  disabled,
  onSend,
  locale,
  isLiveActive,
  onVoiceToggle,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  locale: Locale;
  isLiveActive?: boolean;
  onVoiceToggle?: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
    onSend(text);
  };

  return (
    <form
      className="rv-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={isLiveActive ? "Canlı dinleniyor, lütfen konuşun…" : PLACEHOLDER[locale]}
        aria-label={PLACEHOLDER[locale]}
        style={{
          borderColor: isLiveActive ? "var(--rv-accent)" : undefined,
          boxShadow: isLiveActive ? "0 0 0 2px var(--rv-accent)" : undefined,
        }}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />

      {onVoiceToggle && (
        <button
          type="button"
          className={`rv-mic ${isLiveActive ? "rv-mic-active" : ""}`}
          onClick={onVoiceToggle}
          disabled={disabled}
          title={isLiveActive ? "Canlı Sesli Görüşmeyi Durdur" : "Gemini Live ile Sesli Konuş"}
          aria-label="Sesli Konuş"
        >
          {isLiveActive ? "🔴" : "🎙️"}
        </button>
      )}

      <button type="submit" className="rv-send" disabled={disabled || !value.trim()} aria-label="Gönder">
        ↑
      </button>
    </form>
  );
}
